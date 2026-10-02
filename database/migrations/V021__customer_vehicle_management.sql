-- TT-026: productive client/vehicle management over HTTP.
-- Reads stay in the existing query facade (its grant is preserved by CREATE OR REPLACE).
-- Commands use a separate facade that revalidates the current A/R session under lock
-- and reuses the tested T24/T10 transactions of PKG_VEHICULOS.
CREATE OR REPLACE PACKAGE pkg_consultas_clientes_vehiculos AUTHID DEFINER AS
    PROCEDURE listar_clientes (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER,
        p_q IN VARCHAR2, p_activo IN NUMBER,
        p_despues_creado_en IN VARCHAR2, p_despues_id IN NUMBER,
        p_limite IN NUMBER, p_resultado OUT SYS_REFCURSOR
    );

    PROCEDURE consultar_cliente (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER,
        p_id_cliente IN NUMBER, p_resultado OUT SYS_REFCURSOR
    );

    PROCEDURE listar_vehiculos (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER,
        p_q IN VARCHAR2, p_id_cliente IN NUMBER, p_activo IN NUMBER,
        p_despues_creado_en IN VARCHAR2, p_despues_id IN NUMBER,
        p_limite IN NUMBER, p_resultado OUT SYS_REFCURSOR
    );

    PROCEDURE consultar_vehiculo (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER,
        p_id_vehiculo IN NUMBER, p_resultado OUT SYS_REFCURSOR
    );

    PROCEDURE listar_propiedades (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER, p_id_vehiculo IN NUMBER,
        p_despues_desde_en IN VARCHAR2, p_despues_id IN NUMBER,
        p_limite IN NUMBER, p_resultado OUT SYS_REFCURSOR
    );

    PROCEDURE listar_tipos_vehiculo (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER,
        p_incluir_inactivos IN NUMBER, p_resultado OUT SYS_REFCURSOR
    );
END pkg_consultas_clientes_vehiculos;
/

CREATE OR REPLACE PACKAGE BODY pkg_consultas_clientes_vehiculos AS
    PROCEDURE exigir_recepcion (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER
    ) IS
        l_valido NUMBER;
    BEGIN
        SELECT COUNT(*) INTO l_valido
          FROM usuario u
          JOIN sesion s ON s.id_usuario = u.id_usuario
         WHERE u.id_usuario = p_id_actor
           AND u.tipo_actor = 'INTERNO'
           AND u.activo = 1
           AND s.id_sesion = p_id_sesion
           AND s.version_credencial = u.version_credencial
           AND s.revocada_en IS NULL
           AND s.expira_en > SYSTIMESTAMP
           AND EXISTS (
               SELECT 1 FROM usuario_rol ur
                WHERE ur.id_usuario = u.id_usuario
                  AND ur.codigo_rol IN ('ADMINISTRADOR', 'RECEPCIONISTA')
                  AND ur.retirado_en IS NULL
           );
        IF l_valido <> 1 THEN
            RAISE_APPLICATION_ERROR(-20011, 'ROL_RECEPCION_REQUERIDO');
        END IF;
    END exigir_recepcion;

    FUNCTION instante (p_valor IN VARCHAR2) RETURN TIMESTAMP WITH TIME ZONE IS
    BEGIN
        IF p_valor IS NULL THEN
            RETURN NULL;
        END IF;
        RETURN TO_TIMESTAMP_TZ(REPLACE(p_valor, 'Z', '+00:00'), 'YYYY-MM-DD"T"HH24:MI:SS.FF6TZH:TZM');
    END instante;

    PROCEDURE abrir_clientes (
        p_q IN VARCHAR2, p_activo IN NUMBER,
        p_despues_creado_en IN VARCHAR2, p_despues_id IN NUMBER,
        p_id_cliente IN NUMBER, p_limite IN NUMBER,
        p_resultado OUT SYS_REFCURSOR
    ) IS
        l_despues TIMESTAMP WITH TIME ZONE := instante(p_despues_creado_en);
    BEGIN
        OPEN p_resultado FOR
            SELECT * FROM (
                SELECT TO_CHAR(c.id_cliente, 'FM999999999999999999') id,
                       TO_CHAR(c.version_fila, 'FM9999999999') version,
                       c.nombre, c.telefono, c.email, c.direccion, c.nit,
                       c.activo,
                       CASE WHEN u.id_usuario IS NULL THEN 'SIN_CUENTA'
                            WHEN u.activo = 1 THEN 'ACTIVO' ELSE 'DESACTIVADO' END acceso_digital,
                       TO_CHAR(c.creado_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') posicion_fecha,
                       TO_CHAR(c.id_cliente, 'FM999999999999999999') posicion_id
                  FROM cliente c
                  LEFT JOIN usuario u ON u.id_cliente = c.id_cliente AND u.tipo_actor = 'CLIENTE'
                 WHERE (p_id_cliente IS NULL OR c.id_cliente = p_id_cliente)
                   AND (p_activo IS NULL OR c.activo = p_activo)
                   AND (p_q IS NULL OR INSTR(UPPER(c.nombre), UPPER(p_q)) > 0
                        OR INSTR(UPPER(NVL(c.telefono, '')), UPPER(p_q)) > 0
                        OR INSTR(UPPER(NVL(c.email, '')), UPPER(p_q)) > 0
                        OR INSTR(UPPER(NVL(c.nit, '')), UPPER(p_q)) > 0)
                   AND (l_despues IS NULL OR c.creado_en < l_despues
                        OR (c.creado_en = l_despues AND c.id_cliente < p_despues_id))
                 ORDER BY c.creado_en DESC, c.id_cliente DESC
            ) WHERE ROWNUM <= p_limite;
    END abrir_clientes;

    PROCEDURE listar_clientes (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER,
        p_q IN VARCHAR2, p_activo IN NUMBER,
        p_despues_creado_en IN VARCHAR2, p_despues_id IN NUMBER,
        p_limite IN NUMBER, p_resultado OUT SYS_REFCURSOR
    ) IS
    BEGIN
        exigir_recepcion(p_id_actor, p_id_sesion);
        abrir_clientes(p_q, p_activo, p_despues_creado_en, p_despues_id, NULL, p_limite, p_resultado);
    END listar_clientes;

    PROCEDURE consultar_cliente (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER,
        p_id_cliente IN NUMBER, p_resultado OUT SYS_REFCURSOR
    ) IS
    BEGIN
        exigir_recepcion(p_id_actor, p_id_sesion);
        abrir_clientes(NULL, NULL, NULL, NULL, p_id_cliente, 1, p_resultado);
    END consultar_cliente;

    PROCEDURE abrir_vehiculos (
        p_q IN VARCHAR2, p_id_cliente IN NUMBER, p_activo IN NUMBER,
        p_despues_creado_en IN VARCHAR2, p_despues_id IN NUMBER,
        p_id_vehiculo IN NUMBER, p_limite IN NUMBER,
        p_resultado OUT SYS_REFCURSOR
    ) IS
        l_despues TIMESTAMP WITH TIME ZONE := instante(p_despues_creado_en);
    BEGIN
        OPEN p_resultado FOR
            SELECT * FROM (
                SELECT TO_CHAR(v.id_vehiculo, 'FM999999999999999999') id,
                       v.codigo_tipo tipo_vehiculo, v.placa, v.vin, v.marca, v.modelo,
                       v.anio, v.color, v.activo,
                       TO_CHAR(v.version_fila, 'FM9999999999') version,
                       TO_CHAR(p.id_propiedad, 'FM999999999999999999') propiedad_id,
                       TO_CHAR(p.id_cliente, 'FM999999999999999999') cliente_id,
                       c.nombre nombre_cliente,
                       TO_CHAR(p.desde_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') propiedad_desde_en,
                       TO_CHAR(q.id_qr, 'FM999999999999999999') qr_id,
                       CASE WHEN q.id_qr IS NULL THEN 'SIN_EMISION'
                            WHEN q.revocado_en IS NOT NULL THEN 'REVOCADO'
                            WHEN q.expira_en IS NOT NULL AND q.expira_en <= SYSTIMESTAMP THEN 'EXPIRADO'
                            ELSE 'VIGENTE' END qr_estado,
                       CASE WHEN q.id_qr IS NULL THEN NULL ELSE
                           TO_CHAR(q.emitido_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') END qr_emitido_en,
                       CASE WHEN q.expira_en IS NULL THEN NULL ELSE
                           TO_CHAR(q.expira_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') END qr_expira_en,
                       (SELECT TO_CHAR(o.id_orden, 'FM999999999999999999')
                          FROM orden_trabajo o
                         WHERE o.id_vehiculo = v.id_vehiculo
                           AND o.estado NOT IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'CANCELADO')) orden_activa_id,
                       TO_CHAR(v.creado_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') posicion_fecha,
                       TO_CHAR(v.id_vehiculo, 'FM999999999999999999') posicion_id
                  FROM vehiculo v
                  JOIN propiedad_vehiculo p ON p.id_vehiculo = v.id_vehiculo AND p.hasta_en IS NULL
                  JOIN cliente c ON c.id_cliente = p.id_cliente
                  LEFT JOIN qr_token q ON q.id_qr = (
                      SELECT MAX(q2.id_qr) KEEP (DENSE_RANK LAST ORDER BY q2.emitido_en, q2.id_qr)
                        FROM qr_token q2 WHERE q2.id_vehiculo = v.id_vehiculo
                  )
                 WHERE (p_id_vehiculo IS NULL OR v.id_vehiculo = p_id_vehiculo)
                   AND (p_id_cliente IS NULL OR p.id_cliente = p_id_cliente)
                   AND (p_activo IS NULL OR v.activo = p_activo)
                   AND (p_q IS NULL OR INSTR(UPPER(NVL(v.placa, '')), UPPER(p_q)) > 0
                        OR INSTR(UPPER(NVL(v.vin, '')), UPPER(p_q)) > 0
                        OR INSTR(UPPER(v.marca), UPPER(p_q)) > 0
                        OR INSTR(UPPER(v.modelo), UPPER(p_q)) > 0)
                   AND (l_despues IS NULL OR v.creado_en < l_despues
                        OR (v.creado_en = l_despues AND v.id_vehiculo < p_despues_id))
                 ORDER BY v.creado_en DESC, v.id_vehiculo DESC
            ) WHERE ROWNUM <= p_limite;
    END abrir_vehiculos;

    PROCEDURE listar_vehiculos (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER,
        p_q IN VARCHAR2, p_id_cliente IN NUMBER, p_activo IN NUMBER,
        p_despues_creado_en IN VARCHAR2, p_despues_id IN NUMBER,
        p_limite IN NUMBER, p_resultado OUT SYS_REFCURSOR
    ) IS
    BEGIN
        exigir_recepcion(p_id_actor, p_id_sesion);
        abrir_vehiculos(p_q, p_id_cliente, p_activo, p_despues_creado_en,
                        p_despues_id, NULL, p_limite, p_resultado);
    END listar_vehiculos;

    PROCEDURE consultar_vehiculo (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER,
        p_id_vehiculo IN NUMBER, p_resultado OUT SYS_REFCURSOR
    ) IS
    BEGIN
        exigir_recepcion(p_id_actor, p_id_sesion);
        abrir_vehiculos(NULL, NULL, NULL, NULL, NULL, p_id_vehiculo, 1, p_resultado);
    END consultar_vehiculo;

    PROCEDURE listar_propiedades (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER, p_id_vehiculo IN NUMBER,
        p_despues_desde_en IN VARCHAR2, p_despues_id IN NUMBER,
        p_limite IN NUMBER, p_resultado OUT SYS_REFCURSOR
    ) IS
        l_despues TIMESTAMP WITH TIME ZONE := instante(p_despues_desde_en);
        l_existe NUMBER;
    BEGIN
        exigir_recepcion(p_id_actor, p_id_sesion);
        SELECT COUNT(*) INTO l_existe FROM vehiculo WHERE id_vehiculo = p_id_vehiculo;
        IF l_existe = 0 THEN
            RAISE_APPLICATION_ERROR(-20020, 'RECURSO_NO_ENCONTRADO');
        END IF;
        OPEN p_resultado FOR
            SELECT * FROM (
                SELECT TO_CHAR(p.id_propiedad, 'FM999999999999999999') id,
                       TO_CHAR(p.id_cliente, 'FM999999999999999999') cliente_id,
                       c.nombre nombre_cliente,
                       TO_CHAR(p.desde_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') desde_en,
                       CASE WHEN p.hasta_en IS NULL THEN NULL ELSE
                           TO_CHAR(p.hasta_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') END hasta_en,
                       p.motivo
                  FROM propiedad_vehiculo p
                  JOIN cliente c ON c.id_cliente = p.id_cliente
                 WHERE p.id_vehiculo = p_id_vehiculo
                   AND (l_despues IS NULL OR p.desde_en < l_despues
                        OR (p.desde_en = l_despues AND p.id_propiedad < p_despues_id))
                 ORDER BY p.desde_en DESC, p.id_propiedad DESC
            ) WHERE ROWNUM <= p_limite;
    END listar_propiedades;

    PROCEDURE listar_tipos_vehiculo (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER,
        p_incluir_inactivos IN NUMBER, p_resultado OUT SYS_REFCURSOR
    ) IS
    BEGIN
        exigir_recepcion(p_id_actor, p_id_sesion);
        OPEN p_resultado FOR
            SELECT codigo_tipo codigo, nombre, activo
              FROM tipo_vehiculo
             WHERE NVL(p_incluir_inactivos, 0) = 1 OR activo = 1
             ORDER BY codigo_tipo;
    END listar_tipos_vehiculo;
END pkg_consultas_clientes_vehiculos;
/

CREATE OR REPLACE PACKAGE pkg_clientes_vehiculos_http AUTHID DEFINER AS
    PROCEDURE registrar_cliente (
        p_actor IN NUMBER, p_sesion IN NUMBER, p_clave IN VARCHAR2, p_hash IN RAW,
        p_correlacion IN VARCHAR2, p_nombre IN VARCHAR2, p_telefono IN VARCHAR2,
        p_email IN VARCHAR2, p_direccion IN VARCHAR2, p_nit IN VARCHAR2,
        p_resultado OUT CLOB, p_repetido OUT NUMBER, p_comando OUT VARCHAR2, p_fecha OUT VARCHAR2
    );

    PROCEDURE actualizar_cliente (
        p_actor IN NUMBER, p_sesion IN NUMBER, p_correlacion IN VARCHAR2,
        p_id_cliente IN NUMBER, p_version IN NUMBER, p_cambios IN CLOB,
        p_version_nueva OUT VARCHAR2
    );

    PROCEDURE desactivar (
        p_operacion IN VARCHAR2, p_actor IN NUMBER, p_sesion IN NUMBER, p_clave IN VARCHAR2,
        p_hash IN RAW, p_correlacion IN VARCHAR2, p_id IN NUMBER, p_version IN NUMBER,
        p_motivo IN VARCHAR2,
        p_resultado OUT CLOB, p_repetido OUT NUMBER, p_comando OUT VARCHAR2, p_fecha OUT VARCHAR2
    );

    PROCEDURE registrar_vehiculo (
        p_actor IN NUMBER, p_sesion IN NUMBER, p_clave IN VARCHAR2, p_hash IN RAW,
        p_correlacion IN VARCHAR2, p_id_cliente IN NUMBER, p_codigo_tipo IN VARCHAR2,
        p_placa IN VARCHAR2, p_vin IN VARCHAR2, p_marca IN VARCHAR2, p_modelo IN VARCHAR2,
        p_anio IN NUMBER, p_color IN VARCHAR2, p_motivo IN VARCHAR2, p_token_hash IN RAW,
        p_resultado OUT CLOB, p_repetido OUT NUMBER, p_comando OUT VARCHAR2, p_fecha OUT VARCHAR2
    );

    PROCEDURE actualizar_vehiculo (
        p_actor IN NUMBER, p_sesion IN NUMBER, p_correlacion IN VARCHAR2,
        p_id_vehiculo IN NUMBER, p_version IN NUMBER, p_cambios IN CLOB,
        p_version_nueva OUT VARCHAR2
    );

    PROCEDURE transferir_propietario (
        p_actor IN NUMBER, p_sesion IN NUMBER, p_clave IN VARCHAR2, p_hash IN RAW,
        p_correlacion IN VARCHAR2, p_id_vehiculo IN NUMBER, p_propiedad_esperada IN NUMBER,
        p_propietario_esperado IN NUMBER, p_nuevo_propietario IN NUMBER, p_motivo IN VARCHAR2,
        p_token_hash IN RAW,
        p_resultado OUT CLOB, p_repetido OUT NUMBER, p_comando OUT VARCHAR2, p_fecha OUT VARCHAR2
    );
END pkg_clientes_vehiculos_http;
/

CREATE OR REPLACE PACKAGE BODY pkg_clientes_vehiculos_http AS
    FUNCTION instante (p_valor IN TIMESTAMP WITH TIME ZONE) RETURN VARCHAR2 IS
    BEGIN
        IF p_valor IS NULL THEN
            RETURN NULL;
        END IF;
        RETURN TO_CHAR(p_valor AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"');
    END instante;

    FUNCTION id_texto (p_valor IN NUMBER) RETURN VARCHAR2 IS
    BEGIN
        RETURN TO_CHAR(p_valor, 'FM999999999999999999');
    END id_texto;

    PROCEDURE invalida IS
    BEGIN
        RAISE_APPLICATION_ERROR(-20032, 'SOLICITUD_INVALIDA');
    END invalida;

    -- Same lock order as PKG_VEHICULOS and PKG_USUARIOS_INTERNOS: USUARIO, then SESION.
    -- The validity/role check runs after any wait so a concurrent role withdrawal wins.
    PROCEDURE exigir_recepcion (p_actor IN NUMBER, p_sesion IN NUMBER, p_bloquear IN BOOLEAN) IS
        l_n NUMBER;
    BEGIN
        IF p_bloquear THEN
            BEGIN
                SELECT 1 INTO l_n FROM usuario WHERE id_usuario = p_actor FOR UPDATE;
                SELECT 1 INTO l_n FROM sesion
                 WHERE id_sesion = p_sesion AND id_usuario = p_actor FOR UPDATE;
            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    RAISE_APPLICATION_ERROR(-20010, 'ACTOR_O_SESION_INVALIDO');
            END;
        END IF;
        SELECT COUNT(*) INTO l_n
          FROM sesion s JOIN usuario u ON u.id_usuario = s.id_usuario
         WHERE u.id_usuario = p_actor AND u.tipo_actor = 'INTERNO' AND u.activo = 1
           AND s.id_sesion = p_sesion AND s.version_credencial = u.version_credencial
           AND s.revocada_en IS NULL AND s.expira_en > SYSTIMESTAMP;
        IF l_n <> 1 THEN
            RAISE_APPLICATION_ERROR(-20010, 'ACTOR_O_SESION_INVALIDO');
        END IF;
        SELECT COUNT(*) INTO l_n FROM usuario_rol
         WHERE id_usuario = p_actor AND codigo_rol IN ('ADMINISTRADOR', 'RECEPCIONISTA')
           AND retirado_en IS NULL;
        IF l_n = 0 THEN
            RAISE_APPLICATION_ERROR(-20011, 'ACCION_NO_PERMITIDA');
        END IF;
    END exigir_recepcion;

    PROCEDURE abrir_comando (
        p_operacion IN VARCHAR2, p_actor IN NUMBER, p_sesion IN NUMBER, p_clave IN VARCHAR2,
        p_hash IN RAW, p_id OUT NUMBER, p_instante OUT TIMESTAMP WITH TIME ZONE,
        p_resultado OUT CLOB, p_repetido OUT NUMBER
    ) IS
        l_ambito comando.ambito%TYPE := 'actor:' || id_texto(p_actor) || '/' || p_operacion;
        l_hash comando.solicitud_hash%TYPE;
        l_tipo comando.tipo_operacion%TYPE;
    BEGIN
        IF p_clave IS NULL OR p_hash IS NULL OR UTL_RAW.LENGTH(p_hash) <> 32 THEN
            invalida;
        END IF;
        p_repetido := 0;
        p_resultado := NULL;
        BEGIN
            INSERT INTO comando (
                ambito, clave_idempotencia, solicitud_hash, tipo_operacion,
                id_actor, id_sesion, registrado_en, resultado_codigo
            ) VALUES (
                l_ambito, p_clave, p_hash, p_operacion,
                p_actor, p_sesion, SYSTIMESTAMP, 102
            ) RETURNING id_comando, registrado_en INTO p_id, p_instante;
        EXCEPTION
            WHEN DUP_VAL_ON_INDEX THEN
                SELECT id_comando, registrado_en, solicitud_hash, tipo_operacion, resultado_minimo
                  INTO p_id, p_instante, l_hash, l_tipo, p_resultado
                  FROM comando
                 WHERE ambito = l_ambito AND clave_idempotencia = p_clave
                   FOR UPDATE;
                IF l_hash <> p_hash OR l_tipo <> p_operacion THEN
                    RAISE_APPLICATION_ERROR(-20002, 'CLAVE_REUTILIZADA');
                END IF;
                IF p_resultado IS NULL THEN
                    RAISE_APPLICATION_ERROR(-20003, 'RESULTADO_NO_CONFIRMADO');
                END IF;
                p_repetido := 1;
        END;
    END abrir_comando;

    -- Converts facts reported by PKG_VEHICULOS or constraints into contract codes.
    -- A trailing JSON Pointer names the offending input field for the HTTP layer.
    PROCEDURE traducir (
        p_codigo IN NUMBER, p_mensaje IN VARCHAR2,
        p_vehiculo IN VARCHAR2, p_propietario IN VARCHAR2
    ) IS
    BEGIN
        IF p_codigo = -1 AND INSTR(p_mensaje, 'UQ_VEHICULO_PLACA') > 0 THEN
            RAISE_APPLICATION_ERROR(-20004, 'REFERENCIA_DUPLICADA ' || p_vehiculo || '/placa');
        ELSIF p_codigo = -1 AND INSTR(p_mensaje, 'UQ_VEHICULO_VIN') > 0 THEN
            RAISE_APPLICATION_ERROR(-20004, 'REFERENCIA_DUPLICADA ' || p_vehiculo || '/vin');
        ELSIF p_codigo = -2291 AND INSTR(p_mensaje, 'FK_VEHICULO_TIPO') > 0 THEN
            RAISE_APPLICATION_ERROR(-20040, 'VALIDACION_DOMINIO ' || p_vehiculo || '/tipoVehiculo');
        ELSIF INSTR(p_mensaje, 'CLIENTE_NO_DISPONIBLE') > 0
           OR INSTR(p_mensaje, 'PROPIETARIO_DESTINO_IGUAL') > 0 THEN
            RAISE_APPLICATION_ERROR(-20040, 'VALIDACION_DOMINIO ' || p_propietario);
        ELSIF INSTR(p_mensaje, 'QR_NO_VIGENTE') > 0 THEN
            RAISE_APPLICATION_ERROR(-20021, 'ESTADO_INCOMPATIBLE');
        ELSIF INSTR(p_mensaje, 'VEHICULO_NO_ENCONTRADO') > 0 THEN
            RAISE_APPLICATION_ERROR(-20020, 'RECURSO_NO_ENCONTRADO');
        END IF;
    END traducir;

    FUNCTION estado_qr (p_id_qr IN NUMBER) RETURN JSON_OBJECT_T IS
        l_obj JSON_OBJECT_T := JSON_OBJECT_T();
        l_emitido qr_token.emitido_en%TYPE;
        l_expira qr_token.expira_en%TYPE;
        l_revocado qr_token.revocado_en%TYPE;
        l_estado VARCHAR2(20);
    BEGIN
        SELECT emitido_en, expira_en, revocado_en
          INTO l_emitido, l_expira, l_revocado
          FROM qr_token WHERE id_qr = p_id_qr;
        l_estado := CASE WHEN l_revocado IS NOT NULL THEN 'REVOCADO'
                         WHEN l_expira IS NOT NULL AND l_expira <= SYSTIMESTAMP THEN 'EXPIRADO'
                         ELSE 'VIGENTE' END;
        l_obj.put('generacionId', id_texto(p_id_qr));
        l_obj.put('estado', l_estado);
        l_obj.put('emitidoEn', instante(l_emitido));
        IF l_expira IS NULL THEN
            l_obj.put_null('expiraEn');
        ELSE
            l_obj.put('expiraEn', instante(l_expira));
        END IF;
        RETURN l_obj;
    END estado_qr;

    PROCEDURE auditar (
        p_actor IN NUMBER, p_sesion IN NUMBER, p_comando IN NUMBER, p_accion IN VARCHAR2,
        p_tipo IN VARCHAR2, p_id IN NUMBER, p_motivo IN VARCHAR2, p_cambios IN CLOB,
        p_correlacion IN VARCHAR2
    ) IS
        l_recurso auditoria_evento.identificador_recurso%TYPE := id_texto(p_id);
    BEGIN
        INSERT INTO auditoria_evento (
            id_actor, id_sesion, id_comando, ocurrido_en, accion,
            tipo_recurso, identificador_recurso, motivo, cambios, correlacion
        ) VALUES (
            p_actor, p_sesion, p_comando, SYSTIMESTAMP, p_accion,
            p_tipo, l_recurso, p_motivo, p_cambios, p_correlacion
        );
    END auditar;

    PROCEDURE registrar_cliente (
        p_actor IN NUMBER, p_sesion IN NUMBER, p_clave IN VARCHAR2, p_hash IN RAW,
        p_correlacion IN VARCHAR2, p_nombre IN VARCHAR2, p_telefono IN VARCHAR2,
        p_email IN VARCHAR2, p_direccion IN VARCHAR2, p_nit IN VARCHAR2,
        p_resultado OUT CLOB, p_repetido OUT NUMBER, p_comando OUT VARCHAR2, p_fecha OUT VARCHAR2
    ) IS
        l_comando NUMBER;
        l_instante TIMESTAMP WITH TIME ZONE;
        l_id NUMBER;
        l_obj JSON_OBJECT_T := JSON_OBJECT_T();
    BEGIN
        SAVEPOINT cv_c02;
        IF TRIM(p_nombre) IS NULL OR p_correlacion IS NULL THEN
            invalida;
        END IF;
        abrir_comando('C02', p_actor, p_sesion, p_clave, p_hash,
                      l_comando, l_instante, p_resultado, p_repetido);
        exigir_recepcion(p_actor, p_sesion, TRUE);
        IF p_repetido = 0 THEN
            -- A commercial profile only: no USUARIO, credential or digital access is created.
            INSERT INTO cliente (
                nombre, telefono, email, direccion, nit, activo,
                creado_en, creado_por, actualizado_en, actualizado_por, version_fila
            ) VALUES (
                p_nombre, p_telefono, p_email, p_direccion, p_nit, 1,
                l_instante, p_actor, l_instante, p_actor, 1
            ) RETURNING id_cliente INTO l_id;
            l_obj.put('clienteId', id_texto(l_id));
            l_obj.put('version', '1');
            p_resultado := l_obj.to_clob;
            UPDATE comando SET resultado_codigo = 201, resultado_minimo = p_resultado
             WHERE id_comando = l_comando;
            auditar(p_actor, p_sesion, l_comando, 'C02', 'CLIENTE', l_id,
                    'Registro de perfil comercial sin cuenta digital', p_resultado, p_correlacion);
        END IF;
        p_comando := id_texto(l_comando);
        p_fecha := instante(l_instante);
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK TO cv_c02;
            RAISE;
    END registrar_cliente;

    PROCEDURE actualizar_cliente (
        p_actor IN NUMBER, p_sesion IN NUMBER, p_correlacion IN VARCHAR2,
        p_id_cliente IN NUMBER, p_version IN NUMBER, p_cambios IN CLOB,
        p_version_nueva OUT VARCHAR2
    ) IS
        l_cambios JSON_OBJECT_T;
        l_claves JSON_KEY_LIST;
        l_campos JSON_ARRAY_T := JSON_ARRAY_T();
        l_auditoria JSON_OBJECT_T := JSON_OBJECT_T();
        l_fila cliente%ROWTYPE;
    BEGIN
        SAVEPOINT cv_c04;
        IF p_correlacion IS NULL OR p_version IS NULL OR p_cambios IS NULL THEN
            invalida;
        END IF;
        exigir_recepcion(p_actor, p_sesion, TRUE);
        l_cambios := JSON_OBJECT_T.parse(p_cambios);
        l_claves := l_cambios.get_keys;
        IF l_claves IS NULL OR l_claves.COUNT = 0 THEN
            invalida;
        END IF;
        BEGIN
            SELECT * INTO l_fila FROM cliente WHERE id_cliente = p_id_cliente FOR UPDATE;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RAISE_APPLICATION_ERROR(-20020, 'RECURSO_NO_ENCONTRADO');
        END;
        IF l_fila.version_fila <> p_version THEN
            RAISE_APPLICATION_ERROR(-20022, 'VERSION_DESACTUALIZADA');
        END IF;
        FOR i IN 1 .. l_claves.COUNT LOOP
            CASE l_claves(i)
                WHEN 'nombre' THEN l_fila.nombre := l_cambios.get_string('nombre');
                WHEN 'telefono' THEN l_fila.telefono := l_cambios.get_string('telefono');
                WHEN 'email' THEN l_fila.email := l_cambios.get_string('email');
                WHEN 'direccion' THEN l_fila.direccion := l_cambios.get_string('direccion');
                WHEN 'nit' THEN l_fila.nit := l_cambios.get_string('nit');
                ELSE invalida;
            END CASE;
            l_campos.append(l_claves(i));
        END LOOP;
        IF TRIM(l_fila.nombre) IS NULL THEN
            invalida;
        END IF;
        UPDATE cliente
           SET nombre = l_fila.nombre, telefono = l_fila.telefono, email = l_fila.email,
               direccion = l_fila.direccion, nit = l_fila.nit,
               actualizado_en = SYSTIMESTAMP, actualizado_por = p_actor,
               version_fila = version_fila + 1
         WHERE id_cliente = p_id_cliente
        RETURNING TO_CHAR(version_fila, 'FM9999999999') INTO p_version_nueva;
        -- Audit records which fields changed, not a second copy of contact data.
        l_auditoria.put('campos', l_campos);
        l_auditoria.put('version', p_version_nueva);
        auditar(p_actor, p_sesion, NULL, 'C04', 'CLIENTE', p_id_cliente,
                'Actualización de perfil comercial', l_auditoria.to_clob, p_correlacion);
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK TO cv_c04;
            RAISE;
    END actualizar_cliente;

    PROCEDURE desactivar (
        p_operacion IN VARCHAR2, p_actor IN NUMBER, p_sesion IN NUMBER, p_clave IN VARCHAR2,
        p_hash IN RAW, p_correlacion IN VARCHAR2, p_id IN NUMBER, p_version IN NUMBER,
        p_motivo IN VARCHAR2,
        p_resultado OUT CLOB, p_repetido OUT NUMBER, p_comando OUT VARCHAR2, p_fecha OUT VARCHAR2
    ) IS
        l_comando NUMBER;
        l_instante TIMESTAMP WITH TIME ZONE;
        l_activo NUMBER;
        l_version NUMBER;
        l_obj JSON_OBJECT_T := JSON_OBJECT_T();
    BEGIN
        SAVEPOINT cv_desactivar;
        IF p_operacion IS NULL OR p_operacion NOT IN ('C05', 'V07') OR TRIM(p_motivo) IS NULL
           OR p_version IS NULL OR p_correlacion IS NULL THEN
            invalida;
        END IF;
        abrir_comando(p_operacion, p_actor, p_sesion, p_clave, p_hash,
                      l_comando, l_instante, p_resultado, p_repetido);
        exigir_recepcion(p_actor, p_sesion, TRUE);
        IF p_repetido = 0 THEN
            BEGIN
                IF p_operacion = 'C05' THEN
                    SELECT activo, version_fila INTO l_activo, l_version
                      FROM cliente WHERE id_cliente = p_id FOR UPDATE;
                ELSE
                    SELECT activo, version_fila INTO l_activo, l_version
                      FROM vehiculo WHERE id_vehiculo = p_id FOR UPDATE;
                END IF;
            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    RAISE_APPLICATION_ERROR(-20020, 'RECURSO_NO_ENCONTRADO');
            END;
            IF l_version <> p_version THEN
                RAISE_APPLICATION_ERROR(-20022, 'VERSION_DESACTUALIZADA');
            END IF;
            IF l_activo <> 1 THEN
                RAISE_APPLICATION_ERROR(-20021, 'ESTADO_INCOMPATIBLE');
            END IF;
            -- Only the master's own flag changes: history, ownership, QR, orders and any
            -- digital account (USUARIO) remain untouched.
            IF p_operacion = 'C05' THEN
                UPDATE cliente SET activo = 0, version_fila = l_version + 1,
                       actualizado_en = l_instante, actualizado_por = p_actor
                 WHERE id_cliente = p_id;
                l_obj.put('clienteId', id_texto(p_id));
            ELSE
                UPDATE vehiculo SET activo = 0, version_fila = l_version + 1,
                       actualizado_en = l_instante, actualizado_por = p_actor
                 WHERE id_vehiculo = p_id;
                l_obj.put('vehiculoId', id_texto(p_id));
            END IF;
            l_obj.put('version', TO_CHAR(l_version + 1, 'FM9999999999'));
            l_obj.put('activo', FALSE);
            p_resultado := l_obj.to_clob;
            UPDATE comando SET resultado_codigo = 200, resultado_minimo = p_resultado
             WHERE id_comando = l_comando;
            auditar(p_actor, p_sesion, l_comando, p_operacion,
                    CASE WHEN p_operacion = 'C05' THEN 'CLIENTE' ELSE 'VEHICULO' END,
                    p_id, p_motivo, p_resultado, p_correlacion);
        END IF;
        p_comando := id_texto(l_comando);
        p_fecha := instante(l_instante);
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK TO cv_desactivar;
            RAISE;
    END desactivar;

    PROCEDURE registrar_vehiculo (
        p_actor IN NUMBER, p_sesion IN NUMBER, p_clave IN VARCHAR2, p_hash IN RAW,
        p_correlacion IN VARCHAR2, p_id_cliente IN NUMBER, p_codigo_tipo IN VARCHAR2,
        p_placa IN VARCHAR2, p_vin IN VARCHAR2, p_marca IN VARCHAR2, p_modelo IN VARCHAR2,
        p_anio IN NUMBER, p_color IN VARCHAR2, p_motivo IN VARCHAR2, p_token_hash IN RAW,
        p_resultado OUT CLOB, p_repetido OUT NUMBER, p_comando OUT VARCHAR2, p_fecha OUT VARCHAR2
    ) IS
        l_ambito comando.ambito%TYPE := 'actor:' || id_texto(p_actor) || '/V02';
        l_vehiculo NUMBER;
        l_propiedad NUMBER;
        l_qr NUMBER;
        l_comando NUMBER;
        l_instante TIMESTAMP WITH TIME ZONE;
        l_n NUMBER;
        l_obj JSON_OBJECT_T;
        l_codigo NUMBER;
        l_mensaje VARCHAR2(4000);
    BEGIN
        SAVEPOINT cv_v02;
        IF p_clave IS NULL OR p_hash IS NULL OR UTL_RAW.LENGTH(p_hash) <> 32
           OR p_token_hash IS NULL OR UTL_RAW.LENGTH(p_token_hash) <> 32
           OR TRIM(p_marca) IS NULL OR TRIM(p_modelo) IS NULL OR TRIM(p_motivo) IS NULL
           OR p_correlacion IS NULL THEN
            invalida;
        END IF;
        exigir_recepcion(p_actor, p_sesion, FALSE);
        -- T24: vehicle, first ownership period, QR generation, command and audit in one unit.
        pkg_vehiculos.registrar_vehiculo(
            l_ambito, p_clave, p_hash, p_actor, p_sesion, p_correlacion,
            p_id_cliente, p_codigo_tipo, UPPER(TRIM(p_placa)), UPPER(TRIM(p_vin)),
            p_marca, p_modelo, p_anio, p_color, p_motivo, p_token_hash, NULL,
            l_vehiculo, l_propiedad, l_qr, p_repetido
        );
        SELECT id_comando, registrado_en, resultado_minimo
          INTO l_comando, l_instante, p_resultado
          FROM comando
         WHERE ambito = l_ambito AND clave_idempotencia = p_clave
           FOR UPDATE;
        exigir_recepcion(p_actor, p_sesion, TRUE);
        IF p_repetido = 0 THEN
            SELECT COUNT(*) INTO l_n FROM tipo_vehiculo
             WHERE codigo_tipo = p_codigo_tipo AND activo = 1;
            IF l_n = 0 THEN
                RAISE_APPLICATION_ERROR(-20040, 'VALIDACION_DOMINIO /vehiculo/tipoVehiculo');
            END IF;
            l_obj := JSON_OBJECT_T.parse(p_resultado);
            l_obj.put('version', '1');
            l_obj.put('qr', estado_qr(l_qr));
            p_resultado := l_obj.to_clob;
            UPDATE comando SET resultado_minimo = p_resultado WHERE id_comando = l_comando;
        END IF;
        p_comando := id_texto(l_comando);
        p_fecha := instante(l_instante);
    EXCEPTION
        WHEN OTHERS THEN
            l_codigo := SQLCODE;
            l_mensaje := SQLERRM;
            ROLLBACK TO cv_v02;
            traducir(l_codigo, l_mensaje, '/vehiculo', '/propietarioId');
            RAISE;
    END registrar_vehiculo;

    PROCEDURE actualizar_vehiculo (
        p_actor IN NUMBER, p_sesion IN NUMBER, p_correlacion IN VARCHAR2,
        p_id_vehiculo IN NUMBER, p_version IN NUMBER, p_cambios IN CLOB,
        p_version_nueva OUT VARCHAR2
    ) IS
        l_cambios JSON_OBJECT_T;
        l_claves JSON_KEY_LIST;
        l_campos JSON_ARRAY_T := JSON_ARRAY_T();
        l_auditoria JSON_OBJECT_T := JSON_OBJECT_T();
        l_fila vehiculo%ROWTYPE;
        l_n NUMBER;
        l_codigo NUMBER;
        l_mensaje VARCHAR2(4000);
    BEGIN
        SAVEPOINT cv_v04;
        IF p_correlacion IS NULL OR p_version IS NULL OR p_cambios IS NULL THEN
            invalida;
        END IF;
        exigir_recepcion(p_actor, p_sesion, TRUE);
        l_cambios := JSON_OBJECT_T.parse(p_cambios);
        l_claves := l_cambios.get_keys;
        IF l_claves IS NULL OR l_claves.COUNT = 0 THEN
            invalida;
        END IF;
        BEGIN
            SELECT * INTO l_fila FROM vehiculo WHERE id_vehiculo = p_id_vehiculo FOR UPDATE;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RAISE_APPLICATION_ERROR(-20020, 'RECURSO_NO_ENCONTRADO');
        END;
        IF l_fila.version_fila <> p_version THEN
            RAISE_APPLICATION_ERROR(-20022, 'VERSION_DESACTUALIZADA');
        END IF;
        -- Only descriptors: ownership, QR and order state are not reachable from V04.
        FOR i IN 1 .. l_claves.COUNT LOOP
            CASE l_claves(i)
                WHEN 'tipoVehiculo' THEN
                    l_fila.codigo_tipo := l_cambios.get_string('tipoVehiculo');
                    SELECT COUNT(*) INTO l_n FROM tipo_vehiculo
                     WHERE codigo_tipo = l_fila.codigo_tipo AND activo = 1;
                    IF l_n = 0 THEN
                        RAISE_APPLICATION_ERROR(-20040, 'VALIDACION_DOMINIO /cambios/tipoVehiculo');
                    END IF;
                WHEN 'placa' THEN l_fila.placa := UPPER(TRIM(l_cambios.get_string('placa')));
                WHEN 'vin' THEN l_fila.vin := UPPER(TRIM(l_cambios.get_string('vin')));
                WHEN 'marca' THEN l_fila.marca := TRIM(l_cambios.get_string('marca'));
                WHEN 'modelo' THEN l_fila.modelo := TRIM(l_cambios.get_string('modelo'));
                WHEN 'anio' THEN l_fila.anio := l_cambios.get_number('anio');
                WHEN 'color' THEN l_fila.color := TRIM(l_cambios.get_string('color'));
                ELSE invalida;
            END CASE;
            l_campos.append(l_claves(i));
        END LOOP;
        IF l_fila.marca IS NULL OR l_fila.modelo IS NULL THEN
            invalida;
        END IF;
        UPDATE vehiculo
           SET codigo_tipo = l_fila.codigo_tipo, placa = l_fila.placa, vin = l_fila.vin,
               marca = l_fila.marca, modelo = l_fila.modelo, anio = l_fila.anio,
               color = l_fila.color, actualizado_en = SYSTIMESTAMP,
               actualizado_por = p_actor, version_fila = version_fila + 1
         WHERE id_vehiculo = p_id_vehiculo
        RETURNING TO_CHAR(version_fila, 'FM9999999999') INTO p_version_nueva;
        l_auditoria.put('campos', l_campos);
        l_auditoria.put('version', p_version_nueva);
        auditar(p_actor, p_sesion, NULL, 'V04', 'VEHICULO', p_id_vehiculo,
                'Actualización de descriptores de vehículo', l_auditoria.to_clob, p_correlacion);
    EXCEPTION
        WHEN OTHERS THEN
            l_codigo := SQLCODE;
            l_mensaje := SQLERRM;
            ROLLBACK TO cv_v04;
            traducir(l_codigo, l_mensaje, '/cambios', '/cambios');
            RAISE;
    END actualizar_vehiculo;

    PROCEDURE transferir_propietario (
        p_actor IN NUMBER, p_sesion IN NUMBER, p_clave IN VARCHAR2, p_hash IN RAW,
        p_correlacion IN VARCHAR2, p_id_vehiculo IN NUMBER, p_propiedad_esperada IN NUMBER,
        p_propietario_esperado IN NUMBER, p_nuevo_propietario IN NUMBER, p_motivo IN VARCHAR2,
        p_token_hash IN RAW,
        p_resultado OUT CLOB, p_repetido OUT NUMBER, p_comando OUT VARCHAR2, p_fecha OUT VARCHAR2
    ) IS
        l_ambito comando.ambito%TYPE := 'actor:' || id_texto(p_actor) || '/V06';
        l_anterior NUMBER;
        l_actual NUMBER;
        l_qr NUMBER;
        l_comando NUMBER;
        l_instante TIMESTAMP WITH TIME ZONE;
        l_version NUMBER;
        l_obj JSON_OBJECT_T;
        l_codigo NUMBER;
        l_mensaje VARCHAR2(4000);
    BEGIN
        SAVEPOINT cv_v06;
        IF p_clave IS NULL OR p_hash IS NULL OR UTL_RAW.LENGTH(p_hash) <> 32
           OR p_token_hash IS NULL OR UTL_RAW.LENGTH(p_token_hash) <> 32
           OR TRIM(p_motivo) IS NULL OR p_correlacion IS NULL THEN
            invalida;
        END IF;
        exigir_recepcion(p_actor, p_sesion, FALSE);
        -- T10: close/open contiguous periods and revoke/issue QR in the same commit.
        pkg_vehiculos.transferir_propiedad(
            l_ambito, p_clave, p_hash, p_actor, p_sesion, p_correlacion,
            p_id_vehiculo, p_propiedad_esperada, p_propietario_esperado,
            p_nuevo_propietario, p_motivo, p_token_hash, NULL,
            l_anterior, l_actual, l_qr, p_repetido
        );
        SELECT id_comando, registrado_en, resultado_minimo
          INTO l_comando, l_instante, p_resultado
          FROM comando
         WHERE ambito = l_ambito AND clave_idempotencia = p_clave
           FOR UPDATE;
        exigir_recepcion(p_actor, p_sesion, TRUE);
        IF p_repetido = 0 THEN
            SELECT version_fila INTO l_version FROM vehiculo WHERE id_vehiculo = p_id_vehiculo;
            l_obj := JSON_OBJECT_T.parse(p_resultado);
            l_obj.put('version', TO_CHAR(l_version, 'FM9999999999'));
            l_obj.put('qr', estado_qr(l_qr));
            p_resultado := l_obj.to_clob;
            UPDATE comando SET resultado_minimo = p_resultado WHERE id_comando = l_comando;
        END IF;
        p_comando := id_texto(l_comando);
        p_fecha := instante(l_instante);
    EXCEPTION
        WHEN OTHERS THEN
            l_codigo := SQLCODE;
            l_mensaje := SQLERRM;
            ROLLBACK TO cv_v06;
            traducir(l_codigo, l_mensaje, '/vehiculo', '/nuevoPropietarioId');
            RAISE;
    END transferir_propietario;
END pkg_clientes_vehiculos_http;
/
