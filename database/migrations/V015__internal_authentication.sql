CREATE OR REPLACE PACKAGE pkg_identidad AUTHID DEFINER AS
    PROCEDURE buscar_credencial_interna (
        p_login_normalizado IN VARCHAR2,
        p_encontrado OUT NUMBER,
        p_id_usuario OUT NUMBER,
        p_nombre_mostrado OUT VARCHAR2,
        p_credencial_hash OUT VARCHAR2,
        p_version_credencial OUT NUMBER,
        p_activo OUT NUMBER
    );

    PROCEDURE crear_sesion_interna (
        p_id_usuario IN NUMBER,
        p_version_credencial IN NUMBER,
        p_identificador_publico IN RAW,
        p_sesion_expira_en IN TIMESTAMP WITH TIME ZONE,
        p_dispositivo IN VARCHAR2,
        p_refresh_hash IN RAW,
        p_refresh_expira_en IN TIMESTAMP WITH TIME ZONE,
        p_id_sesion OUT NUMBER
    );

    PROCEDURE validar_sesion (
        p_id_usuario IN NUMBER,
        p_identificador_publico IN RAW,
        p_version_credencial IN NUMBER,
        p_valida OUT NUMBER,
        p_id_sesion OUT NUMBER,
        p_tipo_actor OUT VARCHAR2,
        p_id_cliente OUT NUMBER,
        p_nombre_mostrado OUT VARCHAR2,
        p_roles_json OUT VARCHAR2,
        p_sesion_expira_en OUT VARCHAR2
    );

    PROCEDURE rotar_refresh (
        p_refresh_hash IN RAW,
        p_nuevo_refresh_hash IN RAW,
        p_nuevo_refresh_expira_en IN TIMESTAMP WITH TIME ZONE,
        p_resultado OUT VARCHAR2,
        p_id_usuario OUT NUMBER,
        p_id_sesion OUT NUMBER,
        p_identificador_publico OUT RAW,
        p_version_credencial OUT NUMBER,
        p_sesion_expira_en OUT VARCHAR2,
        p_correlacion IN VARCHAR2
    );

    PROCEDURE revocar_sesion (
        p_id_usuario IN NUMBER,
        p_identificador_publico IN RAW,
        p_version_credencial IN NUMBER,
        p_correlacion IN VARCHAR2,
        p_revocada OUT NUMBER
    );

END pkg_identidad;
/

CREATE OR REPLACE PACKAGE BODY pkg_identidad AS
    FUNCTION instante_utc(p_valor IN TIMESTAMP WITH TIME ZONE) RETURN VARCHAR2 IS
    BEGIN
        RETURN TO_CHAR(
            p_valor AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"',
            'NLS_DATE_LANGUAGE=English'
        );
    END instante_utc;

    PROCEDURE buscar_credencial_interna (
        p_login_normalizado IN VARCHAR2,
        p_encontrado OUT NUMBER,
        p_id_usuario OUT NUMBER,
        p_nombre_mostrado OUT VARCHAR2,
        p_credencial_hash OUT VARCHAR2,
        p_version_credencial OUT NUMBER,
        p_activo OUT NUMBER
    ) IS
    BEGIN
        p_encontrado := 0;
        BEGIN
            SELECT id_usuario, nombre_mostrado, credencial_hash,
                   version_credencial, activo
            INTO p_id_usuario, p_nombre_mostrado, p_credencial_hash,
                 p_version_credencial, p_activo
            FROM usuario
            WHERE login_normalizado = p_login_normalizado
              AND tipo_actor = 'INTERNO';
            p_encontrado := 1;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN NULL;
        END;
    END buscar_credencial_interna;

    PROCEDURE crear_sesion_interna (
        p_id_usuario IN NUMBER,
        p_version_credencial IN NUMBER,
        p_identificador_publico IN RAW,
        p_sesion_expira_en IN TIMESTAMP WITH TIME ZONE,
        p_dispositivo IN VARCHAR2,
        p_refresh_hash IN RAW,
        p_refresh_expira_en IN TIMESTAMP WITH TIME ZONE,
        p_id_sesion OUT NUMBER
    ) IS
        l_version NUMBER;
        l_roles NUMBER;
        l_ahora TIMESTAMP(6) WITH TIME ZONE := SYSTIMESTAMP;
    BEGIN
        SAVEPOINT identidad_crear_sesion;
        SELECT version_credencial INTO l_version
        FROM usuario
        WHERE id_usuario = p_id_usuario
          AND tipo_actor = 'INTERNO'
          AND activo = 1
        FOR UPDATE;

        SELECT COUNT(*) INTO l_roles
        FROM usuario_rol
        WHERE id_usuario = p_id_usuario
          AND retirado_en IS NULL
          AND codigo_rol <> 'CLIENTE';

        IF l_version <> p_version_credencial OR l_roles = 0
           OR p_sesion_expira_en <= l_ahora
           OR p_refresh_expira_en <= l_ahora
           OR p_refresh_expira_en > p_sesion_expira_en THEN
            RAISE_APPLICATION_ERROR(-20051, 'CREDENCIALES_INVALIDAS');
        END IF;

        INSERT INTO sesion (
            id_usuario, identificador_publico, creada_en, expira_en,
            version_credencial, dispositivo
        ) VALUES (
            p_id_usuario, p_identificador_publico, l_ahora,
            p_sesion_expira_en, p_version_credencial, p_dispositivo
        ) RETURNING id_sesion INTO p_id_sesion;

        INSERT INTO token_acceso (
            tipo, id_usuario, id_sesion, token_hash, emitido_en, expira_en
        ) VALUES (
            'RENOVACION', p_id_usuario, p_id_sesion,
            p_refresh_hash, l_ahora, p_refresh_expira_en
        );
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK TO identidad_crear_sesion;
            RAISE;
    END crear_sesion_interna;

    PROCEDURE validar_sesion (
        p_id_usuario IN NUMBER,
        p_identificador_publico IN RAW,
        p_version_credencial IN NUMBER,
        p_valida OUT NUMBER,
        p_id_sesion OUT NUMBER,
        p_tipo_actor OUT VARCHAR2,
        p_id_cliente OUT NUMBER,
        p_nombre_mostrado OUT VARCHAR2,
        p_roles_json OUT VARCHAR2,
        p_sesion_expira_en OUT VARCHAR2
    ) IS
        l_expira sesion.expira_en%TYPE;
    BEGIN
        p_valida := 0;
        BEGIN
            SELECT s.id_sesion, u.tipo_actor, u.id_cliente, u.nombre_mostrado,
                   s.expira_en,
                   COALESCE((
                       SELECT JSON_ARRAYAGG(ur.codigo_rol ORDER BY ur.codigo_rol RETURNING VARCHAR2)
                       FROM usuario_rol ur
                       WHERE ur.id_usuario = u.id_usuario
                         AND ur.retirado_en IS NULL
                   ), '[]')
            INTO p_id_sesion, p_tipo_actor, p_id_cliente, p_nombre_mostrado,
                 l_expira, p_roles_json
            FROM usuario u
            JOIN sesion s ON s.id_usuario = u.id_usuario
            WHERE u.id_usuario = p_id_usuario
              AND u.activo = 1
              AND u.version_credencial = p_version_credencial
              AND ((u.tipo_actor = 'INTERNO' AND EXISTS (
                    SELECT 1 FROM usuario_rol ur
                    WHERE ur.id_usuario = u.id_usuario
                      AND ur.retirado_en IS NULL
                      AND ur.codigo_rol <> 'CLIENTE'
                  )) OR (u.tipo_actor = 'CLIENTE' AND EXISTS (
                    SELECT 1 FROM usuario_rol ur
                    WHERE ur.id_usuario = u.id_usuario
                      AND ur.retirado_en IS NULL
                      AND ur.codigo_rol = 'CLIENTE'
                  )))
              AND s.identificador_publico = p_identificador_publico
              AND s.version_credencial = p_version_credencial
              AND s.revocada_en IS NULL
              AND s.expira_en > SYSTIMESTAMP;
            p_sesion_expira_en := instante_utc(l_expira);
            p_valida := 1;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN NULL;
        END;
    END validar_sesion;

    PROCEDURE revocar_familia(
        p_id_sesion IN NUMBER,
        p_motivo IN VARCHAR2,
        p_ahora IN TIMESTAMP WITH TIME ZONE
    ) IS
    BEGIN
        UPDATE sesion
        SET revocada_en = COALESCE(revocada_en, p_ahora),
            motivo_revocacion = COALESCE(motivo_revocacion, p_motivo)
        WHERE id_sesion = p_id_sesion;
        UPDATE token_acceso
        SET revocado_en = COALESCE(revocado_en, p_ahora)
        WHERE id_sesion = p_id_sesion
          AND tipo = 'RENOVACION';
    END revocar_familia;

    PROCEDURE rotar_refresh (
        p_refresh_hash IN RAW,
        p_nuevo_refresh_hash IN RAW,
        p_nuevo_refresh_expira_en IN TIMESTAMP WITH TIME ZONE,
        p_resultado OUT VARCHAR2,
        p_id_usuario OUT NUMBER,
        p_id_sesion OUT NUMBER,
        p_identificador_publico OUT RAW,
        p_version_credencial OUT NUMBER,
        p_sesion_expira_en OUT VARCHAR2,
        p_correlacion IN VARCHAR2
    ) IS
        l_id_token NUMBER;
        l_usado token_acceso.usado_en%TYPE;
        l_revocado token_acceso.revocado_en%TYPE;
        l_token_expira token_acceso.expira_en%TYPE;
        l_sesion_expira sesion.expira_en%TYPE;
        l_sesion_revocada sesion.revocada_en%TYPE;
        l_usuario_activo usuario.activo%TYPE;
        l_usuario_version usuario.version_credencial%TYPE;
        l_sesion_version sesion.version_credencial%TYPE;
        l_nuevo_expira token_acceso.expira_en%TYPE;
        l_ahora TIMESTAMP(6) WITH TIME ZONE := SYSTIMESTAMP;
    BEGIN
        SAVEPOINT identidad_rotar_refresh;
        p_resultado := 'INVALIDA';
        BEGIN
            SELECT id_token, id_usuario, id_sesion
            INTO l_id_token, p_id_usuario, p_id_sesion
            FROM token_acceso
            WHERE token_hash = p_refresh_hash
              AND tipo = 'RENOVACION';
        EXCEPTION
            WHEN NO_DATA_FOUND THEN RETURN;
        END;

        SELECT activo, version_credencial
        INTO l_usuario_activo, l_usuario_version
        FROM usuario
        WHERE id_usuario = p_id_usuario
        FOR UPDATE;

        SELECT identificador_publico, version_credencial, expira_en, revocada_en
        INTO p_identificador_publico, l_sesion_version, l_sesion_expira,
             l_sesion_revocada
        FROM sesion
        WHERE id_sesion = p_id_sesion
          AND id_usuario = p_id_usuario
        FOR UPDATE;

        SELECT usado_en, revocado_en, expira_en
        INTO l_usado, l_revocado, l_token_expira
        FROM token_acceso
        WHERE id_token = l_id_token
        FOR UPDATE;

        IF l_usado IS NOT NULL THEN
            revocar_familia(p_id_sesion, 'REUTILIZACION_REFRESH', l_ahora);
            INSERT INTO auditoria_evento (
                id_actor, id_sesion, ocurrido_en, accion, tipo_recurso,
                identificador_recurso, motivo, correlacion
            ) VALUES (
                p_id_usuario, p_id_sesion, l_ahora, 'REVOCAR_POR_REUSO_REFRESH',
                'SESION', TO_CHAR(p_id_sesion), 'Reutilizacion de refresh consumido',
                p_correlacion
            );
            p_resultado := 'REUTILIZADA';
            RETURN;
        END IF;

        IF l_revocado IS NOT NULL OR l_token_expira <= l_ahora
           OR l_usuario_activo <> 1 OR l_sesion_revocada IS NOT NULL
           OR l_sesion_expira <= l_ahora
           OR l_sesion_version <> l_usuario_version
           OR p_nuevo_refresh_expira_en <= l_ahora THEN
            RETURN;
        END IF;

        l_nuevo_expira := LEAST(p_nuevo_refresh_expira_en, l_sesion_expira);

        UPDATE token_acceso SET usado_en = l_ahora WHERE id_token = l_id_token;
        INSERT INTO token_acceso (
            tipo, id_usuario, id_sesion, token_hash, emitido_en,
            expira_en, id_predecesor
        ) VALUES (
            'RENOVACION', p_id_usuario, p_id_sesion, p_nuevo_refresh_hash,
            l_ahora, l_nuevo_expira, l_id_token
        );
        p_version_credencial := l_usuario_version;
        p_sesion_expira_en := instante_utc(l_sesion_expira);
        p_resultado := 'ROTADA';
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK TO identidad_rotar_refresh;
            RAISE;
    END rotar_refresh;

    PROCEDURE revocar_sesion (
        p_id_usuario IN NUMBER,
        p_identificador_publico IN RAW,
        p_version_credencial IN NUMBER,
        p_correlacion IN VARCHAR2,
        p_revocada OUT NUMBER
    ) IS
        l_id_sesion NUMBER;
        l_ahora TIMESTAMP(6) WITH TIME ZONE := SYSTIMESTAMP;
    BEGIN
        SAVEPOINT identidad_revocar_sesion;
        p_revocada := 0;
        BEGIN
            SELECT s.id_sesion INTO l_id_sesion
            FROM usuario u
            JOIN sesion s ON s.id_usuario = u.id_usuario
            WHERE u.id_usuario = p_id_usuario
              AND u.version_credencial = p_version_credencial
              AND s.identificador_publico = p_identificador_publico
              AND s.version_credencial = p_version_credencial
            FOR UPDATE OF u.id_usuario, s.id_sesion;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN RETURN;
        END;
        revocar_familia(l_id_sesion, 'CIERRE_SESION', l_ahora);
        INSERT INTO auditoria_evento (
            id_actor, id_sesion, ocurrido_en, accion, tipo_recurso,
            identificador_recurso, motivo, correlacion
        ) VALUES (
            p_id_usuario, l_id_sesion, l_ahora, 'CERRAR_SESION', 'SESION',
            TO_CHAR(l_id_sesion), 'Cierre solicitado por el usuario', p_correlacion
        );
        p_revocada := 1;
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK TO identidad_revocar_sesion;
            RAISE;
    END revocar_sesion;

END pkg_identidad;
/

CREATE OR REPLACE PACKAGE pkg_identidad_bootstrap AUTHID DEFINER AS
    PROCEDURE crear_usuario_interno (
        p_login_normalizado IN VARCHAR2,
        p_nombre_mostrado IN VARCHAR2,
        p_credencial_hash IN VARCHAR2,
        p_roles_json IN VARCHAR2,
        p_id_usuario OUT NUMBER
    );
END pkg_identidad_bootstrap;
/

CREATE OR REPLACE PACKAGE BODY pkg_identidad_bootstrap AS
    PROCEDURE crear_usuario_interno (
        p_login_normalizado IN VARCHAR2,
        p_nombre_mostrado IN VARCHAR2,
        p_credencial_hash IN VARCHAR2,
        p_roles_json IN VARCHAR2,
        p_id_usuario OUT NUMBER
    ) IS
        l_ahora TIMESTAMP(6) WITH TIME ZONE := SYSTIMESTAMP;
        l_total NUMBER;
        l_distintos NUMBER;
        l_validos NUMBER;
    BEGIN
        SAVEPOINT identidad_bootstrap;
        IF p_credencial_hash NOT LIKE '$argon2id$v=19$m=65536,p=1,t=3$%' THEN
            RAISE_APPLICATION_ERROR(-20053, 'CREDENCIAL_BOOTSTRAP_INVALIDA');
        END IF;
        SELECT COUNT(*), COUNT(DISTINCT codigo_rol),
               SUM(CASE WHEN codigo_rol IN (
                   'ADMINISTRADOR', 'RECEPCIONISTA', 'MECANICO', 'INVENTARIO'
               ) THEN 1 ELSE 0 END)
        INTO l_total, l_distintos, l_validos
        FROM JSON_TABLE(
            p_roles_json,
            '$[*]' COLUMNS (codigo_rol VARCHAR2(20 CHAR) PATH '$' ERROR ON ERROR)
        );
        IF l_total < 1 OR l_total > 4 OR l_total <> l_distintos
           OR l_total <> NVL(l_validos, 0) THEN
            RAISE_APPLICATION_ERROR(-20052, 'ROLES_BOOTSTRAP_INVALIDOS');
        END IF;

        INSERT INTO usuario (
            tipo_actor, id_cliente, login_normalizado, nombre_mostrado,
            credencial_hash, version_credencial, activo,
            creado_en, actualizado_en, version_fila
        ) VALUES (
            'INTERNO', NULL, p_login_normalizado, p_nombre_mostrado,
            p_credencial_hash, 1, 1, l_ahora, l_ahora, 1
        ) RETURNING id_usuario INTO p_id_usuario;

        INSERT INTO usuario_rol (
            id_usuario, codigo_rol, asignado_en, asignado_por
        )
        SELECT p_id_usuario, codigo_rol, l_ahora, p_id_usuario
        FROM JSON_TABLE(
            p_roles_json,
            '$[*]' COLUMNS (codigo_rol VARCHAR2(20 CHAR) PATH '$' ERROR ON ERROR)
        );

        UPDATE usuario
        SET creado_por = p_id_usuario,
            actualizado_por = p_id_usuario
        WHERE id_usuario = p_id_usuario;
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK TO identidad_bootstrap;
            RAISE;
    END crear_usuario_interno;
END pkg_identidad_bootstrap;
/
