CREATE OR REPLACE PACKAGE pkg_diagnostico_gratuito AUTHID DEFINER AS
    PROCEDURE directorio (p_actor IN NUMBER, p_sesion IN NUMBER, p_orden IN NUMBER,
        p_q IN VARCHAR2, p_despues_id IN NUMBER, p_limite IN NUMBER, p_resultado OUT SYS_REFCURSOR);
    PROCEDURE participantes (p_actor IN NUMBER, p_sesion IN NUMBER, p_orden IN NUMBER,
        p_vigentes IN NUMBER, p_despues_id IN NUMBER, p_limite IN NUMBER, p_resultado OUT SYS_REFCURSOR);
    PROCEDURE trabajos (p_actor IN NUMBER, p_sesion IN NUMBER, p_orden IN NUMBER,
        p_despues_id IN NUMBER, p_limite IN NUMBER, p_resultado OUT SYS_REFCURSOR);
    PROCEDURE diagnosticos (p_actor IN NUMBER, p_sesion IN NUMBER, p_orden IN NUMBER,
        p_despues_id IN NUMBER, p_limite IN NUMBER, p_resultado OUT SYS_REFCURSOR);
    PROCEDURE ejecutar (
        p_operacion IN VARCHAR2, p_actor IN NUMBER, p_sesion IN NUMBER,
        p_orden IN NUMBER, p_destinatario IN NUMBER, p_recurso IN NUMBER,
        p_version IN NUMBER, p_tipo IN VARCHAR2, p_servicio IN VARCHAR2,
        p_descripcion IN VARCHAR2, p_gratuito IN NUMBER,
        p_detalle IN CLOB, p_resumen IN VARCHAR2, p_motivo IN VARCHAR2,
        p_ambito IN VARCHAR2, p_clave IN VARCHAR2, p_hash IN RAW,
        p_correlacion IN VARCHAR2, p_resultado OUT CLOB,
        p_repetido OUT NUMBER, p_comando OUT NUMBER, p_confirmado_en OUT VARCHAR2
    );
END pkg_diagnostico_gratuito;
/

CREATE OR REPLACE PACKAGE BODY pkg_diagnostico_gratuito AS
    FUNCTION instante(p_fecha IN TIMESTAMP WITH TIME ZONE) RETURN VARCHAR2 IS
    BEGIN
        RETURN TO_CHAR(p_fecha AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"');
    END;

    PROCEDURE exigir_sesion(p_actor IN NUMBER, p_sesion IN NUMBER, p_bloquear IN BOOLEAN) IS
        l_tipo usuario.tipo_actor%TYPE;
        l_dummy NUMBER;
    BEGIN
        IF p_bloquear THEN
            SELECT tipo_actor INTO l_tipo FROM usuario
             WHERE id_usuario=p_actor AND activo=1 FOR UPDATE;
            SELECT 1 INTO l_dummy FROM sesion s JOIN usuario u ON u.id_usuario=s.id_usuario
             WHERE s.id_sesion=p_sesion AND s.id_usuario=p_actor
               AND s.version_credencial=u.version_credencial
               AND s.revocada_en IS NULL AND s.expira_en>SYSTIMESTAMP FOR UPDATE OF s.id_sesion;
        ELSE
            SELECT tipo_actor INTO l_tipo FROM usuario
             WHERE id_usuario=p_actor AND activo=1;
            SELECT 1 INTO l_dummy FROM sesion s JOIN usuario u ON u.id_usuario=s.id_usuario
             WHERE s.id_sesion=p_sesion AND s.id_usuario=p_actor
               AND s.version_credencial=u.version_credencial
               AND s.revocada_en IS NULL AND s.expira_en>SYSTIMESTAMP;
        END IF;
        IF l_tipo <> 'INTERNO' THEN RAISE_APPLICATION_ERROR(-20010,'ACTOR_O_SESION_INVALIDO'); END IF;
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20010,'ACTOR_O_SESION_INVALIDO');
    END;

    FUNCTION tiene_rol(p_actor IN NUMBER,p_rol IN VARCHAR2) RETURN BOOLEAN IS l_count NUMBER;
    BEGIN
        SELECT COUNT(*) INTO l_count FROM usuario_rol
         WHERE id_usuario=p_actor AND codigo_rol=p_rol AND retirado_en IS NULL;
        RETURN l_count>0;
    END;

    FUNCTION participa(p_actor IN NUMBER,p_orden IN NUMBER) RETURN BOOLEAN IS l_count NUMBER;
    BEGIN
        SELECT COUNT(*) INTO l_count FROM orden_mecanico
         WHERE id_mecanico=p_actor AND id_orden=p_orden AND retirado_en IS NULL;
        RETURN l_count>0;
    END;

    PROCEDURE exigir_lectura(p_actor IN NUMBER,p_sesion IN NUMBER,p_orden IN NUMBER) IS
        l_count NUMBER;
    BEGIN
        exigir_sesion(p_actor,p_sesion,FALSE);
        SELECT COUNT(*) INTO l_count FROM orden_trabajo WHERE id_orden=p_orden;
        IF l_count=0 THEN RAISE_APPLICATION_ERROR(-20020,'RECURSO_NO_ENCONTRADO'); END IF;
        IF NOT (tiene_rol(p_actor,'ADMINISTRADOR') OR tiene_rol(p_actor,'RECEPCIONISTA')
            OR (tiene_rol(p_actor,'MECANICO') AND participa(p_actor,p_orden))) THEN
            RAISE_APPLICATION_ERROR(-20011,'ACCION_NO_PERMITIDA');
        END IF;
    END;

    PROCEDURE directorio (p_actor IN NUMBER,p_sesion IN NUMBER,p_orden IN NUMBER,
        p_q IN VARCHAR2,p_despues_id IN NUMBER,p_limite IN NUMBER,p_resultado OUT SYS_REFCURSOR) IS
        l_count NUMBER;
    BEGIN
        exigir_sesion(p_actor,p_sesion,FALSE);
        SELECT COUNT(*) INTO l_count FROM orden_trabajo WHERE id_orden=p_orden;
        IF l_count=0 THEN RAISE_APPLICATION_ERROR(-20020,'RECURSO_NO_ENCONTRADO'); END IF;
        IF NOT (tiene_rol(p_actor,'RECEPCIONISTA') OR
           (tiene_rol(p_actor,'MECANICO') AND participa(p_actor,p_orden))) THEN
            RAISE_APPLICATION_ERROR(-20011,'ACCION_NO_PERMITIDA');
        END IF;
        OPEN p_resultado FOR SELECT * FROM (
            SELECT TO_CHAR(u.id_usuario,'FM999999999999999999') id,u.nombre_mostrado nombre
              FROM usuario u WHERE u.tipo_actor='INTERNO' AND u.activo=1
               AND EXISTS (SELECT 1 FROM usuario_rol ur WHERE ur.id_usuario=u.id_usuario
                    AND ur.codigo_rol='MECANICO' AND ur.retirado_en IS NULL)
               AND (p_q IS NULL OR INSTR(UPPER(u.nombre_mostrado),UPPER(p_q))>0)
               AND (p_despues_id IS NULL OR u.id_usuario<p_despues_id)
             ORDER BY u.id_usuario DESC
        ) WHERE ROWNUM<=p_limite;
    END;

    PROCEDURE participantes (p_actor IN NUMBER,p_sesion IN NUMBER,p_orden IN NUMBER,
        p_vigentes IN NUMBER,p_despues_id IN NUMBER,p_limite IN NUMBER,p_resultado OUT SYS_REFCURSOR) IS
    BEGIN
        exigir_lectura(p_actor,p_sesion,p_orden);
        OPEN p_resultado FOR SELECT * FROM (
            SELECT TO_CHAR(om.id_participacion,'FM999999999999999999') id,
                   TO_CHAR(u.id_usuario,'FM999999999999999999') mecanico_id,
                   u.nombre_mostrado mecanico_nombre,
                   TO_CHAR(om.asignado_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') asignado_en,
                   CASE WHEN om.retirado_en IS NULL THEN NULL ELSE
                       TO_CHAR(om.retirado_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') END retirado_en,
                   om.motivo_retiro
              FROM orden_mecanico om JOIN usuario u ON u.id_usuario=om.id_mecanico
             WHERE om.id_orden=p_orden AND
                   (p_despues_id IS NULL OR om.id_participacion<p_despues_id) AND
                   (p_vigentes IS NULL OR (p_vigentes=1 AND om.retirado_en IS NULL)
                     OR (p_vigentes=0 AND om.retirado_en IS NOT NULL))
             ORDER BY om.id_participacion DESC
        ) WHERE ROWNUM<=p_limite;
    END;

    PROCEDURE trabajos (p_actor IN NUMBER,p_sesion IN NUMBER,p_orden IN NUMBER,
        p_despues_id IN NUMBER,p_limite IN NUMBER,p_resultado OUT SYS_REFCURSOR) IS
    BEGIN
        exigir_lectura(p_actor,p_sesion,p_orden);
        OPEN p_resultado FOR SELECT * FROM (
            SELECT TO_CHAR(t.id_trabajo,'FM999999999999999999') id,
                   TO_CHAR(t.version_fila,'FM9999999999') version,t.tipo,t.tipo_servicio,
                   t.descripcion,t.estado,t.gratuito diagnostico_gratuito
              FROM trabajo t WHERE t.id_orden=p_orden
                AND (p_despues_id IS NULL OR t.id_trabajo<p_despues_id)
                ORDER BY t.id_trabajo DESC
        ) WHERE ROWNUM<=p_limite;
    END;

    PROCEDURE diagnosticos (p_actor IN NUMBER,p_sesion IN NUMBER,p_orden IN NUMBER,
        p_despues_id IN NUMBER,p_limite IN NUMBER,p_resultado OUT SYS_REFCURSOR) IS
        l_tecnico NUMBER;
    BEGIN
        exigir_lectura(p_actor,p_sesion,p_orden);
        IF tiene_rol(p_actor,'MECANICO') AND participa(p_actor,p_orden) THEN l_tecnico:=1;
        ELSE l_tecnico:=0; END IF;
        OPEN p_resultado FOR SELECT * FROM (
            SELECT TO_CHAR(d.id_diagnostico,'FM999999999999999999') id,
                   d.numero_revision,TO_CHAR(d.id_revision_anterior,'FM999999999999999999') revision_anterior_id,
                   TO_CHAR(d.id_trabajo_diagnostico,'FM999999999999999999') trabajo_diagnostico_id,
                   d.detalle_tecnico,l_tecnico puede_ver_detalle,
                   d.resumen_cliente,TO_CHAR(d.confirmado_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') confirmado_en
              FROM diagnostico d WHERE d.id_orden=p_orden
                AND (p_despues_id IS NULL OR d.id_diagnostico<p_despues_id)
             ORDER BY d.id_diagnostico DESC
        ) WHERE ROWNUM<=p_limite;
    END;

    PROCEDURE abrir_comando(p_operacion IN VARCHAR2,p_actor IN NUMBER,p_sesion IN NUMBER,
        p_ambito IN VARCHAR2,p_clave IN VARCHAR2,p_hash IN RAW,
        p_id OUT NUMBER,p_resultado OUT CLOB,p_repetido OUT NUMBER,p_fecha OUT TIMESTAMP WITH TIME ZONE) IS
        l_tipo comando.tipo_operacion%TYPE;
        l_hash comando.solicitud_hash%TYPE;
        l_actor comando.id_actor%TYPE;
        l_sesion comando.id_sesion%TYPE;
    BEGIN
        IF p_ambito<>'actor:'||TO_CHAR(p_actor)||'/'||p_operacion OR p_hash IS NULL THEN
            RAISE_APPLICATION_ERROR(-20032,'SOLICITUD_INVALIDA'); END IF;
        p_repetido:=0;
        BEGIN
            INSERT INTO comando(ambito,clave_idempotencia,solicitud_hash,tipo_operacion,
                id_actor,id_sesion,registrado_en,resultado_codigo)
            VALUES(p_ambito,p_clave,p_hash,p_operacion,p_actor,p_sesion,SYSTIMESTAMP,102)
            RETURNING id_comando,registrado_en INTO p_id,p_fecha;
        EXCEPTION WHEN DUP_VAL_ON_INDEX THEN
            SELECT id_comando,registrado_en,tipo_operacion,solicitud_hash,
                id_actor,id_sesion,resultado_minimo
              INTO p_id,p_fecha,l_tipo,l_hash,l_actor,l_sesion,p_resultado
              FROM comando WHERE ambito=p_ambito AND clave_idempotencia=p_clave;
            IF l_tipo<>p_operacion OR l_hash<>p_hash OR l_actor<>p_actor OR l_sesion<>p_sesion THEN
                RAISE_APPLICATION_ERROR(-20002,'CLAVE_REUTILIZADA'); END IF;
            IF p_resultado IS NULL THEN RAISE_APPLICATION_ERROR(-20003,'RESULTADO_NO_CONFIRMADO'); END IF;
            p_repetido:=1;
        END;
    END;

    PROCEDURE ejecutar (
        p_operacion IN VARCHAR2,p_actor IN NUMBER,p_sesion IN NUMBER,p_orden IN NUMBER,
        p_destinatario IN NUMBER,p_recurso IN NUMBER,p_version IN NUMBER,
        p_tipo IN VARCHAR2,p_servicio IN VARCHAR2,p_descripcion IN VARCHAR2,p_gratuito IN NUMBER,
        p_detalle IN CLOB,p_resumen IN VARCHAR2,p_motivo IN VARCHAR2,
        p_ambito IN VARCHAR2,p_clave IN VARCHAR2,p_hash IN RAW,p_correlacion IN VARCHAR2,
        p_resultado OUT CLOB,p_repetido OUT NUMBER,p_comando OUT NUMBER,p_confirmado_en OUT VARCHAR2
    ) IS
        l_fecha TIMESTAMP WITH TIME ZONE;
        l_estado orden_trabajo.estado%TYPE;
        l_proposito orden_trabajo.proposito%TYPE;
        l_orden_version orden_trabajo.version_fila%TYPE;
        l_trabajo trabajo%ROWTYPE;
        l_id NUMBER;
        l_revision NUMBER;
        l_anterior NUMBER;
        l_count NUMBER;
        l_destinatario usuario.tipo_actor%TYPE;
        l_retirado_en TIMESTAMP WITH TIME ZONE;
    BEGIN
        SAVEPOINT dg_operation;
        IF p_operacion NOT IN ('ASIGNAR_MECANICO','RETIRAR_MECANICO','PROPONER_TRABAJO',
            'INICIAR_TRABAJO','CONFIRMAR_DIAGNOSTICO') THEN
            RAISE_APPLICATION_ERROR(-20032,'SOLICITUD_INVALIDA'); END IF;
        abrir_comando(p_operacion,p_actor,p_sesion,p_ambito,p_clave,p_hash,
            p_comando,p_resultado,p_repetido,l_fecha);
        -- Actor and destination accounts are acquired in ascending ID order.
        IF p_operacion='ASIGNAR_MECANICO' AND p_destinatario<p_actor THEN
            BEGIN
                SELECT tipo_actor INTO l_destinatario FROM usuario
                 WHERE id_usuario=p_destinatario AND activo=1 FOR UPDATE;
            EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20012,'ROL_REQUERIDO'); END;
        END IF;
        exigir_sesion(p_actor,p_sesion,TRUE);
        IF p_operacion='ASIGNAR_MECANICO' THEN
            IF p_destinatario>=p_actor THEN
                BEGIN
                    SELECT tipo_actor INTO l_destinatario FROM usuario
                     WHERE id_usuario=p_destinatario AND activo=1 FOR UPDATE;
                EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20012,'ROL_REQUERIDO'); END;
            END IF;
            IF l_destinatario<>'INTERNO' OR NOT tiene_rol(p_destinatario,'MECANICO') THEN
                RAISE_APPLICATION_ERROR(-20012,'ROL_REQUERIDO'); END IF;
        END IF;
        BEGIN
            SELECT estado,proposito,version_fila INTO l_estado,l_proposito,l_orden_version
              FROM orden_trabajo WHERE id_orden=p_orden FOR UPDATE;
        EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20020,'RECURSO_NO_ENCONTRADO'); END;
        IF p_operacion IN ('ASIGNAR_MECANICO','RETIRAR_MECANICO') THEN
            IF NOT (tiene_rol(p_actor,'RECEPCIONISTA') OR
                (tiene_rol(p_actor,'MECANICO') AND participa(p_actor,p_orden))) THEN
                RAISE_APPLICATION_ERROR(-20011,'ACCION_NO_PERMITIDA'); END IF;
        ELSE
            IF NOT tiene_rol(p_actor,'MECANICO') OR NOT participa(p_actor,p_orden) THEN
                RAISE_APPLICATION_ERROR(-20011,'ACCION_NO_PERMITIDA'); END IF;
        END IF;
        IF p_repetido=1 THEN
            p_confirmado_en:=instante(l_fecha); RETURN;
        END IF;
        IF l_proposito<>'COMERCIAL' OR l_estado NOT IN ('RECIBIDO','EN_DIAGNOSTICO') THEN
            RAISE_APPLICATION_ERROR(-20021,'ESTADO_INCOMPATIBLE'); END IF;

        IF p_operacion='ASIGNAR_MECANICO' THEN
            SELECT COUNT(*) INTO l_count FROM orden_mecanico
             WHERE id_orden=p_orden AND id_mecanico=p_destinatario AND retirado_en IS NULL;
            IF l_count>0 THEN RAISE_APPLICATION_ERROR(-20022,'REFERENCIA_DUPLICADA'); END IF;
            INSERT INTO orden_mecanico(id_orden,id_mecanico,asignado_en,asignado_por)
            VALUES(p_orden,p_destinatario,SYSTIMESTAMP,p_actor)
            RETURNING id_participacion INTO l_id;
            SELECT JSON_OBJECT('participacionId' VALUE TO_CHAR(l_id),
                'mecanicoId' VALUE TO_CHAR(p_destinatario) RETURNING CLOB)
                INTO p_resultado FROM dual;
        ELSIF p_operacion='RETIRAR_MECANICO' THEN
            UPDATE orden_mecanico SET retirado_en=SYSTIMESTAMP,retirado_por=p_actor,
                motivo_retiro=TRIM(p_motivo)
             WHERE id_participacion=p_recurso AND id_orden=p_orden AND retirado_en IS NULL;
            IF SQL%ROWCOUNT<>1 THEN RAISE_APPLICATION_ERROR(-20021,'ESTADO_INCOMPATIBLE'); END IF;
            SELECT retirado_en INTO l_retirado_en FROM orden_mecanico WHERE id_participacion=p_recurso;
            SELECT JSON_OBJECT('participacionId' VALUE TO_CHAR(p_recurso),
                'retiradoEn' VALUE TO_CHAR(l_retirado_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') RETURNING CLOB)
                INTO p_resultado FROM dual;
        ELSIF p_operacion='PROPONER_TRABAJO' THEN
            IF p_tipo<>'DIAGNOSTICO' OR p_gratuito<>1 OR p_servicio IS NULL
               OR p_descripcion IS NULL OR LENGTH(TRIM(p_descripcion))=0 THEN
                RAISE_APPLICATION_ERROR(-20023,'ALCANCE_NO_AUTORIZADO'); END IF;
            INSERT INTO trabajo(id_orden,tipo,tipo_servicio,descripcion,estado,gratuito,
                creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
            VALUES(p_orden,'DIAGNOSTICO',p_servicio,TRIM(p_descripcion),'PROPUESTO',1,
                SYSTIMESTAMP,p_actor,SYSTIMESTAMP,p_actor,1)
            RETURNING id_trabajo INTO l_id;
            SELECT JSON_OBJECT('trabajoId' VALUE TO_CHAR(l_id),
                'version' VALUE '1','estado' VALUE 'PROPUESTO' RETURNING CLOB)
                INTO p_resultado FROM dual;
        ELSIF p_operacion='INICIAR_TRABAJO' THEN
            BEGIN
                SELECT * INTO l_trabajo FROM trabajo
                 WHERE id_trabajo=p_recurso AND id_orden=p_orden FOR UPDATE;
            EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20020,'RECURSO_NO_ENCONTRADO'); END;
            IF l_trabajo.version_fila<>p_version THEN
                RAISE_APPLICATION_ERROR(-20024,'VERSION_DESACTUALIZADA'); END IF;
            IF l_trabajo.estado<>'PROPUESTO' OR l_estado NOT IN ('RECIBIDO','EN_DIAGNOSTICO') THEN
                RAISE_APPLICATION_ERROR(-20021,'ESTADO_INCOMPATIBLE'); END IF;
            IF l_trabajo.tipo<>'DIAGNOSTICO' OR l_trabajo.gratuito<>1 THEN
                RAISE_APPLICATION_ERROR(-20023,'ALCANCE_NO_AUTORIZADO'); END IF;
            INSERT INTO trabajo_evento(id_trabajo,id_mecanico,tipo,ocurrido_en,
                horas_aportadas,costo_interno,motivo,registrado_en,registrado_por,id_comando)
            VALUES(p_recurso,p_actor,'INICIO',SYSTIMESTAMP,NULL,0,TRIM(p_motivo),
                SYSTIMESTAMP,p_actor,p_comando) RETURNING id_evento_trabajo INTO l_id;
            UPDATE trabajo SET estado='EN_EJECUCION',version_fila=version_fila+1,
                actualizado_en=SYSTIMESTAMP,actualizado_por=p_actor WHERE id_trabajo=p_recurso;
            IF l_estado='RECIBIDO' THEN
                UPDATE orden_trabajo SET estado='EN_DIAGNOSTICO',version_fila=version_fila+1
                 WHERE id_orden=p_orden;
                INSERT INTO orden_evento(id_orden,tipo,estado_anterior,estado_nuevo,motivo,
                    registrado_en,registrado_por,id_comando)
                VALUES(p_orden,'ESTADO','RECIBIDO','EN_DIAGNOSTICO',TRIM(p_motivo),
                    SYSTIMESTAMP,p_actor,p_comando);
                l_orden_version:=l_orden_version+1;
            END IF;
            SELECT JSON_OBJECT('trabajoId' VALUE TO_CHAR(p_recurso),
                'version' VALUE TO_CHAR(p_version+1),'eventoId' VALUE TO_CHAR(l_id),
                'estado' VALUE 'EN_EJECUCION','ordenEstado' VALUE 'EN_DIAGNOSTICO',
                'ordenVersion' VALUE TO_CHAR(l_orden_version) RETURNING CLOB)
                INTO p_resultado FROM dual;
        ELSE
            BEGIN
                SELECT * INTO l_trabajo FROM trabajo
                 WHERE id_trabajo=p_recurso AND id_orden=p_orden FOR UPDATE;
            EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20020,'RECURSO_NO_ENCONTRADO'); END;
            SELECT COUNT(*) INTO l_count FROM trabajo_evento
             WHERE id_trabajo=p_recurso AND tipo='INICIO';
            IF l_trabajo.tipo<>'DIAGNOSTICO' OR l_trabajo.gratuito<>1
               OR l_trabajo.estado<>'EN_EJECUCION' OR l_count=0
               OR l_estado<>'EN_DIAGNOSTICO' THEN
                RAISE_APPLICATION_ERROR(-20021,'ESTADO_INCOMPATIBLE'); END IF;
            IF p_detalle IS NULL OR DBMS_LOB.GETLENGTH(p_detalle)=0 OR
               p_resumen IS NULL OR LENGTH(TRIM(p_resumen))=0 THEN
                RAISE_APPLICATION_ERROR(-20032,'SOLICITUD_INVALIDA'); END IF;
            SELECT NVL(MAX(numero_revision),0),MAX(id_diagnostico) KEEP
                (DENSE_RANK LAST ORDER BY numero_revision)
              INTO l_revision,l_anterior FROM diagnostico WHERE id_orden=p_orden;
            l_revision:=l_revision+1;
            INSERT INTO diagnostico(id_orden,id_trabajo_diagnostico,numero_revision,
                id_revision_anterior,detalle_tecnico,resumen_cliente,confirmado_en,
                registrado_en,registrado_por,id_comando)
            VALUES(p_orden,p_recurso,l_revision,l_anterior,p_detalle,TRIM(p_resumen),
                SYSTIMESTAMP,SYSTIMESTAMP,p_actor,p_comando)
            RETURNING id_diagnostico INTO l_id;
            SELECT JSON_OBJECT('diagnosticoId' VALUE TO_CHAR(l_id),
                'numeroRevision' VALUE l_revision,'evidenciasIds' VALUE JSON_ARRAY() FORMAT JSON RETURNING CLOB)
                INTO p_resultado FROM dual;
        END IF;
        UPDATE comando SET resultado_codigo=CASE WHEN p_operacion='INICIAR_TRABAJO' OR
            p_operacion='RETIRAR_MECANICO' THEN 200 ELSE 201 END,
            resultado_minimo=p_resultado WHERE id_comando=p_comando;
        p_confirmado_en:=instante(l_fecha);
        INSERT INTO auditoria_evento(id_actor,id_sesion,id_comando,ocurrido_en,
            accion,tipo_recurso,identificador_recurso,motivo,correlacion)
        VALUES(p_actor,p_sesion,p_comando,SYSTIMESTAMP,p_operacion,'ORDEN_TRABAJO',
            TO_CHAR(p_orden),NVL(p_motivo,p_operacion),p_correlacion);
    EXCEPTION WHEN OTHERS THEN ROLLBACK TO dg_operation; RAISE;
    END;
END pkg_diagnostico_gratuito;
/
