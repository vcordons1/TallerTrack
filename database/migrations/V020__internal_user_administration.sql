CREATE OR REPLACE PACKAGE pkg_usuarios_internos AUTHID DEFINER AS
    PROCEDURE consultar(p_actor NUMBER,p_sesion NUMBER,p_id NUMBER,p_q VARCHAR2,p_activo NUMBER,
        p_rol VARCHAR2,p_fecha VARCHAR2,p_despues NUMBER,p_limite NUMBER,p_resultado OUT SYS_REFCURSOR);
    PROCEDURE ejecutar(p_operacion VARCHAR2,p_actor NUMBER,p_sesion NUMBER,p_id NUMBER,p_version NUMBER,
        p_login VARCHAR2,p_nombre VARCHAR2,p_roles VARCHAR2,p_credencial VARCHAR2,p_motivo VARCHAR2,
        p_clave VARCHAR2,p_hash RAW,p_correlacion VARCHAR2,p_resultado OUT CLOB,
        p_repetido OUT NUMBER,p_comando OUT VARCHAR2,p_fecha OUT VARCHAR2);
END pkg_usuarios_internos;
/
CREATE OR REPLACE PACKAGE BODY pkg_usuarios_internos AS
    PROCEDURE exigir_admin(p_actor NUMBER,p_sesion NUMBER,p_bloquear BOOLEAN) IS l_n NUMBER;
    BEGIN
        IF p_bloquear THEN
            SELECT s.id_sesion INTO l_n FROM sesion s JOIN usuario u ON u.id_usuario=s.id_usuario
            WHERE u.id_usuario=p_actor AND u.tipo_actor='INTERNO' AND u.activo=1
              AND s.id_sesion=p_sesion AND s.version_credencial=u.version_credencial
              AND s.revocada_en IS NULL AND s.expira_en>SYSTIMESTAMP FOR UPDATE OF s.id_sesion;
        ELSE
            SELECT s.id_sesion INTO l_n FROM sesion s JOIN usuario u ON u.id_usuario=s.id_usuario
            WHERE u.id_usuario=p_actor AND u.tipo_actor='INTERNO' AND u.activo=1
              AND s.id_sesion=p_sesion AND s.version_credencial=u.version_credencial
              AND s.revocada_en IS NULL AND s.expira_en>SYSTIMESTAMP;
        END IF;
        SELECT COUNT(*) INTO l_n FROM usuario_rol WHERE id_usuario=p_actor
          AND codigo_rol='ADMINISTRADOR' AND retirado_en IS NULL;
        IF l_n=0 THEN RAISE_APPLICATION_ERROR(-20011,'ACCION_NO_PERMITIDA'); END IF;
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20010,'ACTOR_O_SESION_INVALIDO');
    END;

    PROCEDURE consultar(p_actor NUMBER,p_sesion NUMBER,p_id NUMBER,p_q VARCHAR2,p_activo NUMBER,
        p_rol VARCHAR2,p_fecha VARCHAR2,p_despues NUMBER,p_limite NUMBER,p_resultado OUT SYS_REFCURSOR) IS
        l_n NUMBER;
    BEGIN
        exigir_admin(p_actor,p_sesion,FALSE);
        IF p_limite IS NULL OR p_limite<1 OR p_limite>101 THEN
            RAISE_APPLICATION_ERROR(-20032,'SOLICITUD_INVALIDA'); END IF;
        IF p_id IS NOT NULL THEN
            SELECT COUNT(*) INTO l_n FROM usuario WHERE id_usuario=p_id AND tipo_actor='INTERNO';
            IF l_n=0 THEN RAISE_APPLICATION_ERROR(-20020,'RECURSO_NO_ENCONTRADO'); END IF;
        END IF;
        OPEN p_resultado FOR SELECT * FROM (
            SELECT TO_CHAR(u.id_usuario,'FM999999999999999999') id,
                TO_CHAR(u.version_fila,'FM9999999999') version,u.login_normalizado login,
                u.nombre_mostrado nombre,u.activo,
                (SELECT JSON_ARRAYAGG(ur.codigo_rol ORDER BY ur.codigo_rol RETURNING VARCHAR2(1000))
                 FROM usuario_rol ur WHERE ur.id_usuario=u.id_usuario AND ur.retirado_en IS NULL) roles,
                TO_CHAR(u.creado_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') fecha
            FROM usuario u WHERE u.tipo_actor='INTERNO' AND (p_id IS NULL OR u.id_usuario=p_id)
              AND (p_activo IS NULL OR u.activo=p_activo)
              AND (p_q IS NULL OR INSTR(UPPER(u.nombre_mostrado),UPPER(p_q))>0
                    OR INSTR(UPPER(u.login_normalizado),UPPER(p_q))>0)
              AND (p_rol IS NULL OR EXISTS (SELECT 1 FROM usuario_rol ur WHERE ur.id_usuario=u.id_usuario
                    AND ur.codigo_rol=p_rol AND ur.retirado_en IS NULL))
              AND (p_fecha IS NULL OR u.creado_en<TO_TIMESTAMP_TZ(REPLACE(p_fecha,'Z','+00:00'),'YYYY-MM-DD"T"HH24:MI:SS.FF6TZH:TZM')
                OR (u.creado_en=TO_TIMESTAMP_TZ(REPLACE(p_fecha,'Z','+00:00'),'YYYY-MM-DD"T"HH24:MI:SS.FF6TZH:TZM') AND u.id_usuario<p_despues))
            ORDER BY u.creado_en DESC,u.id_usuario DESC
        ) WHERE ROWNUM<=p_limite;
    END;

    PROCEDURE ejecutar(p_operacion VARCHAR2,p_actor NUMBER,p_sesion NUMBER,p_id NUMBER,p_version NUMBER,
        p_login VARCHAR2,p_nombre VARCHAR2,p_roles VARCHAR2,p_credencial VARCHAR2,p_motivo VARCHAR2,
        p_clave VARCHAR2,p_hash RAW,p_correlacion VARCHAR2,p_resultado OUT CLOB,
        p_repetido OUT NUMBER,p_comando OUT VARCHAR2,p_fecha OUT VARCHAR2) IS
        l_ambito VARCHAR2(150); l_comando NUMBER; l_hash RAW(32); l_instante TIMESTAMP WITH TIME ZONE;
        l_id NUMBER; l_usuario usuario%ROWTYPE; l_n NUMBER; l_total NUMBER; l_distintos NUMBER;
        l_validos NUMBER; l_admin NUMBER; l_roles VARCHAR2(1000); l_version NUMBER; l_obj JSON_OBJECT_T;
    BEGIN
        SAVEPOINT usuarios_comando;
        IF p_operacion IS NULL OR p_operacion NOT IN ('I11','I13','I14') OR p_hash IS NULL
          OR UTL_RAW.LENGTH(p_hash)<>32 OR p_clave IS NULL OR p_correlacion IS NULL THEN
            RAISE_APPLICATION_ERROR(-20032,'SOLICITUD_INVALIDA'); END IF;
        l_ambito:='actor:'||TO_CHAR(p_actor)||'/'||p_operacion;
        p_repetido:=0;
        BEGIN
            INSERT INTO comando(ambito,clave_idempotencia,solicitud_hash,tipo_operacion,id_actor,id_sesion,registrado_en,resultado_codigo)
            VALUES(l_ambito,p_clave,p_hash,p_operacion,p_actor,p_sesion,SYSTIMESTAMP,102)
            RETURNING id_comando,registrado_en INTO l_comando,l_instante;
        EXCEPTION WHEN DUP_VAL_ON_INDEX THEN
            SELECT id_comando,registrado_en,solicitud_hash,resultado_minimo
              INTO l_comando,l_instante,l_hash,p_resultado FROM comando
              WHERE ambito=l_ambito AND clave_idempotencia=p_clave FOR UPDATE;
            p_repetido:=1;
        END;
        -- All candidate administrators plus actor/target lock in the same ascending order.
        -- A later count runs after any wait, preventing two administrators removing each other.
        FOR r IN (SELECT u.id_usuario FROM usuario u WHERE u.id_usuario IN (p_actor,p_id)
            OR EXISTS (SELECT 1 FROM usuario_rol ur WHERE ur.id_usuario=u.id_usuario
                AND ur.codigo_rol='ADMINISTRADOR' AND ur.retirado_en IS NULL)
            ORDER BY u.id_usuario FOR UPDATE OF u.id_usuario) LOOP NULL; END LOOP;
        exigir_admin(p_actor,p_sesion,TRUE);
        IF p_repetido=1 THEN
            IF l_hash<>p_hash THEN RAISE_APPLICATION_ERROR(-20002,'CLAVE_REUTILIZADA'); END IF;
            IF p_resultado IS NULL THEN RAISE_APPLICATION_ERROR(-20003,'RESULTADO_NO_CONFIRMADO'); END IF;
        ELSE
            IF p_operacion IN ('I11','I13') THEN
                SELECT COUNT(*),COUNT(DISTINCT codigo),SUM(CASE WHEN codigo IN
                  ('ADMINISTRADOR','RECEPCIONISTA','MECANICO','INVENTARIO') THEN 1 ELSE 0 END)
                  INTO l_total,l_distintos,l_validos FROM JSON_TABLE(p_roles,'$[*]' COLUMNS(codigo VARCHAR2(30) PATH '$'));
                IF l_total=0 THEN RAISE_APPLICATION_ERROR(-20012,'ROL_REQUERIDO'); END IF;
                IF l_total<>l_distintos OR l_total<>l_validos THEN
                    RAISE_APPLICATION_ERROR(-20032,'SOLICITUD_INVALIDA'); END IF;
                SELECT JSON_ARRAYAGG(codigo ORDER BY codigo RETURNING VARCHAR2(1000)) INTO l_roles
                  FROM JSON_TABLE(p_roles,'$[*]' COLUMNS(codigo VARCHAR2(30) PATH '$'));
            END IF;
            IF p_operacion='I11' THEN
                IF p_login IS NULL OR LENGTH(p_login)>150 OR p_nombre IS NULL OR LENGTH(p_nombre)>200
                  OR p_credencial IS NULL OR p_credencial NOT LIKE '$argon2id$v=19$m=65536,p=1,t=3$%' THEN
                    RAISE_APPLICATION_ERROR(-20032,'SOLICITUD_INVALIDA'); END IF;
                BEGIN
                    INSERT INTO usuario(tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,
                        version_credencial,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
                    VALUES('INTERNO',p_login,p_nombre,p_credencial,1,1,SYSTIMESTAMP,p_actor,SYSTIMESTAMP,p_actor,1)
                    RETURNING id_usuario INTO l_id;
                EXCEPTION WHEN DUP_VAL_ON_INDEX THEN RAISE_APPLICATION_ERROR(-20004,'REFERENCIA_DUPLICADA'); END;
                l_version:=1;
            ELSE
                BEGIN
                    SELECT * INTO l_usuario FROM usuario WHERE id_usuario=p_id AND tipo_actor='INTERNO';
                EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20020,'RECURSO_NO_ENCONTRADO'); END;
                IF l_usuario.activo<>1 THEN RAISE_APPLICATION_ERROR(-20021,'ESTADO_INCOMPATIBLE'); END IF;
                IF p_version IS NULL OR l_usuario.version_fila<>p_version THEN
                    RAISE_APPLICATION_ERROR(-20022,'VERSION_DESACTUALIZADA'); END IF;
                IF p_motivo IS NULL OR LENGTH(p_motivo)>500 THEN RAISE_APPLICATION_ERROR(-20032,'SOLICITUD_INVALIDA'); END IF;
                SELECT COUNT(*) INTO l_admin FROM usuario_rol WHERE id_usuario=p_id
                  AND codigo_rol='ADMINISTRADOR' AND retirado_en IS NULL;
                SELECT COUNT(*) INTO l_n FROM JSON_TABLE(p_roles,'$[*]' COLUMNS(codigo VARCHAR2(30) PATH '$'))
                  WHERE codigo='ADMINISTRADOR';
                IF l_admin>0 AND (p_operacion='I14' OR l_n=0) THEN
                    SELECT COUNT(*) INTO l_n FROM usuario u WHERE activo=1 AND tipo_actor='INTERNO'
                      AND EXISTS (SELECT 1 FROM usuario_rol ur WHERE ur.id_usuario=u.id_usuario
                        AND ur.codigo_rol='ADMINISTRADOR' AND ur.retirado_en IS NULL);
                    IF l_n<=1 THEN RAISE_APPLICATION_ERROR(-20023,'ULTIMO_ADMINISTRADOR'); END IF;
                END IF;
                l_id:=p_id; l_version:=l_usuario.version_fila+1;
                UPDATE usuario SET version_fila=l_version,actualizado_por=p_actor,actualizado_en=SYSTIMESTAMP,
                    activo=CASE WHEN p_operacion='I14' THEN 0 ELSE activo END,
                    version_credencial=version_credencial+CASE WHEN p_operacion='I14' THEN 1 ELSE 0 END
                  WHERE id_usuario=l_id;
                IF p_operacion='I13' THEN
                    UPDATE usuario_rol SET retirado_en=SYSTIMESTAMP,retirado_por=p_actor,motivo_retiro=p_motivo
                      WHERE id_usuario=l_id AND retirado_en IS NULL AND codigo_rol NOT IN
                        (SELECT codigo FROM JSON_TABLE(p_roles,'$[*]' COLUMNS(codigo VARCHAR2(30) PATH '$')));
                ELSE
                    UPDATE sesion SET revocada_en=SYSTIMESTAMP,motivo_revocacion='CUENTA_DESACTIVADA'
                      WHERE id_usuario=l_id AND revocada_en IS NULL;
                    UPDATE token_acceso SET revocado_en=SYSTIMESTAMP
                      WHERE id_usuario=l_id AND revocado_en IS NULL;
                END IF;
            END IF;
            IF p_operacion IN ('I11','I13') THEN
                INSERT INTO usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por)
                SELECT l_id,codigo,SYSTIMESTAMP,p_actor FROM JSON_TABLE(p_roles,'$[*]' COLUMNS(codigo VARCHAR2(30) PATH '$')) r
                  WHERE NOT EXISTS (SELECT 1 FROM usuario_rol ur WHERE ur.id_usuario=l_id
                    AND ur.codigo_rol=r.codigo AND ur.retirado_en IS NULL);
            END IF;
            l_obj:=JSON_OBJECT_T(); l_obj.put('usuarioId',TO_CHAR(l_id,'FM999999999999999999'));
            l_obj.put('version',TO_CHAR(l_version,'FM9999999999'));
            IF p_operacion='I13' THEN l_obj.put('roles',JSON_ARRAY_T.parse(l_roles)); END IF;
            IF p_operacion='I14' THEN l_obj.put('activo',FALSE); END IF;
            p_resultado:=l_obj.to_clob();
            UPDATE comando SET resultado_minimo=p_resultado,resultado_codigo=CASE WHEN p_operacion='I11' THEN 201 ELSE 200 END
              WHERE id_comando=l_comando;
            INSERT INTO auditoria_evento(id_actor,id_sesion,id_comando,ocurrido_en,accion,tipo_recurso,
                identificador_recurso,motivo,cambios,correlacion)
            VALUES(p_actor,p_sesion,l_comando,SYSTIMESTAMP,p_operacion,'USUARIO',TO_CHAR(l_id),
                CASE WHEN p_operacion='I11' THEN 'Alta presencial de usuario interno' ELSE p_motivo END,p_resultado,p_correlacion);
        END IF;
        p_comando:=TO_CHAR(l_comando,'FM999999999999999999');
        p_fecha:=TO_CHAR(l_instante AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"');
    EXCEPTION WHEN OTHERS THEN ROLLBACK TO usuarios_comando; RAISE;
    END;
END pkg_usuarios_internos;
/
