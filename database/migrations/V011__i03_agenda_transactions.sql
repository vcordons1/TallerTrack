CREATE OR REPLACE PACKAGE pkg_agenda AUTHID DEFINER AS
    PROCEDURE solicitar_cita (
        p_ambito IN VARCHAR2,
        p_clave_idempotencia IN VARCHAR2,
        p_solicitud_hash IN RAW,
        p_id_actor IN NUMBER,
        p_id_sesion IN NUMBER,
        p_correlacion IN VARCHAR2,
        p_id_vehiculo IN NUMBER,
        p_origen IN VARCHAR2,
        p_id_qr_origen IN NUMBER,
        p_nombre_solicitante IN VARCHAR2,
        p_contacto_solicitante IN VARCHAR2,
        p_motivo IN VARCHAR2,
        p_inicio_solicitado IN TIMESTAMP WITH TIME ZONE,
        p_id_cita OUT NUMBER,
        p_version OUT NUMBER,
        p_repetido OUT NUMBER
    );

    PROCEDURE confirmar_cita (
        p_ambito IN VARCHAR2,
        p_clave_idempotencia IN VARCHAR2,
        p_solicitud_hash IN RAW,
        p_id_actor IN NUMBER,
        p_id_sesion IN NUMBER,
        p_correlacion IN VARCHAR2,
        p_id_cita IN NUMBER,
        p_version_esperada IN NUMBER,
        p_inicio IN TIMESTAMP WITH TIME ZONE,
        p_fin IN TIMESTAMP WITH TIME ZONE,
        p_motivo IN VARCHAR2,
        p_version OUT NUMBER,
        p_repetido OUT NUMBER
    );

    PROCEDURE reprogramar_cita (
        p_ambito IN VARCHAR2,
        p_clave_idempotencia IN VARCHAR2,
        p_solicitud_hash IN RAW,
        p_id_actor IN NUMBER,
        p_id_sesion IN NUMBER,
        p_correlacion IN VARCHAR2,
        p_id_cita IN NUMBER,
        p_version_esperada IN NUMBER,
        p_inicio IN TIMESTAMP WITH TIME ZONE,
        p_fin IN TIMESTAMP WITH TIME ZONE,
        p_motivo IN VARCHAR2,
        p_version OUT NUMBER,
        p_repetido OUT NUMBER
    );

    PROCEDURE cancelar_cita (
        p_ambito IN VARCHAR2,
        p_clave_idempotencia IN VARCHAR2,
        p_solicitud_hash IN RAW,
        p_id_actor IN NUMBER,
        p_id_sesion IN NUMBER,
        p_correlacion IN VARCHAR2,
        p_id_cita IN NUMBER,
        p_version_esperada IN NUMBER,
        p_motivo IN VARCHAR2,
        p_version OUT NUMBER,
        p_repetido OUT NUMBER
    );

    PROCEDURE registrar_inasistencia (
        p_ambito IN VARCHAR2,
        p_clave_idempotencia IN VARCHAR2,
        p_solicitud_hash IN RAW,
        p_id_actor IN NUMBER,
        p_id_sesion IN NUMBER,
        p_correlacion IN VARCHAR2,
        p_id_cita IN NUMBER,
        p_version_esperada IN NUMBER,
        p_motivo IN VARCHAR2,
        p_version OUT NUMBER,
        p_repetido OUT NUMBER
    );

    PROCEDURE atender_sin_orden (
        p_ambito IN VARCHAR2,
        p_clave_idempotencia IN VARCHAR2,
        p_solicitud_hash IN RAW,
        p_id_actor IN NUMBER,
        p_id_sesion IN NUMBER,
        p_correlacion IN VARCHAR2,
        p_id_cita IN NUMBER,
        p_version_esperada IN NUMBER,
        p_motivo IN VARCHAR2,
        p_version OUT NUMBER,
        p_repetido OUT NUMBER
    );
END pkg_agenda;
/

CREATE OR REPLACE PACKAGE BODY pkg_agenda AS
    PROCEDURE abrir_comando (
        p_ambito IN VARCHAR2,
        p_clave IN VARCHAR2,
        p_hash IN RAW,
        p_tipo IN VARCHAR2,
        p_actor IN NUMBER,
        p_sesion IN NUMBER,
        p_id_comando OUT NUMBER,
        p_resultado OUT CLOB,
        p_repetido OUT NUMBER
    ) IS
        l_hash comando.solicitud_hash%TYPE;
        l_tipo comando.tipo_operacion%TYPE;
        l_actor comando.id_actor%TYPE;
        l_sesion comando.id_sesion%TYPE;
    BEGIN
        p_repetido := 0;
        p_resultado := NULL;
        BEGIN
            INSERT INTO comando (
                ambito, clave_idempotencia, solicitud_hash, tipo_operacion,
                id_actor, id_sesion, registrado_en, resultado_codigo
            ) VALUES (
                p_ambito, p_clave, p_hash, p_tipo,
                p_actor, p_sesion, SYSTIMESTAMP, 102
            ) RETURNING id_comando INTO p_id_comando;
        EXCEPTION
            WHEN DUP_VAL_ON_INDEX THEN
                SELECT id_comando, solicitud_hash, tipo_operacion,
                       id_actor, id_sesion, resultado_minimo
                INTO p_id_comando, l_hash, l_tipo,
                     l_actor, l_sesion, p_resultado
                FROM comando
                WHERE ambito = p_ambito
                  AND clave_idempotencia = p_clave;

                IF l_hash <> p_hash
                   OR l_tipo <> p_tipo
                   OR NVL(l_actor, -1) <> NVL(p_actor, -1)
                   OR NVL(l_sesion, -1) <> NVL(p_sesion, -1) THEN
                    RAISE_APPLICATION_ERROR(-20002, 'CLAVE_REUTILIZADA');
                END IF;
                IF p_resultado IS NULL THEN
                    RAISE_APPLICATION_ERROR(-20003, 'RESULTADO_NO_CONFIRMADO');
                END IF;
                p_repetido := 1;
        END;
    END abrir_comando;

    PROCEDURE bloquear_actor (
        p_actor IN NUMBER,
        p_sesion IN NUMBER,
        p_tipo_actor OUT VARCHAR2,
        p_id_cliente OUT NUMBER
    ) IS
        l_dummy NUMBER;
    BEGIN
        SELECT tipo_actor, id_cliente
        INTO p_tipo_actor, p_id_cliente
        FROM usuario
        WHERE id_usuario = p_actor
          AND activo = 1
        FOR UPDATE;

        SELECT 1 INTO l_dummy
        FROM sesion
        WHERE id_sesion = p_sesion
          AND id_usuario = p_actor
          AND revocada_en IS NULL
          AND expira_en > SYSTIMESTAMP
        FOR UPDATE;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20010, 'ACTOR_O_SESION_INVALIDO');
    END bloquear_actor;

    FUNCTION tiene_rol (p_actor IN NUMBER, p_rol IN VARCHAR2) RETURN BOOLEAN IS
        l_count NUMBER;
    BEGIN
        SELECT COUNT(*) INTO l_count
        FROM usuario_rol
        WHERE id_usuario = p_actor
          AND codigo_rol = p_rol
          AND retirado_en IS NULL;
        RETURN l_count = 1;
    END tiene_rol;

    PROCEDURE exigir_gestor (
        p_actor IN NUMBER,
        p_sesion IN NUMBER
    ) IS
        l_tipo VARCHAR2(10);
        l_cliente NUMBER;
    BEGIN
        bloquear_actor(p_actor, p_sesion, l_tipo, l_cliente);
        IF l_tipo <> 'INTERNO'
           OR NOT (tiene_rol(p_actor, 'ADMINISTRADOR') OR tiene_rol(p_actor, 'RECEPCIONISTA')) THEN
            RAISE_APPLICATION_ERROR(-20011, 'ROL_REQUERIDO');
        END IF;
    END exigir_gestor;

    PROCEDURE completar_comando (
        p_id_comando IN NUMBER,
        p_id_cita IN NUMBER,
        p_version IN NUMBER,
        p_estado IN VARCHAR2,
        p_codigo IN NUMBER,
        p_resultado OUT CLOB
    ) IS
    BEGIN
        p_resultado := JSON_OBJECT(
            'citaId' VALUE TO_CHAR(p_id_cita),
            'version' VALUE TO_CHAR(p_version),
            'estado' VALUE p_estado
        );
        UPDATE comando
        SET resultado_codigo = p_codigo,
            resultado_minimo = p_resultado
        WHERE id_comando = p_id_comando;
    END completar_comando;

    PROCEDURE auditar (
        p_actor IN NUMBER,
        p_sesion IN NUMBER,
        p_id_comando IN NUMBER,
        p_ahora IN TIMESTAMP WITH TIME ZONE,
        p_accion IN VARCHAR2,
        p_id_cita IN NUMBER,
        p_motivo IN VARCHAR2,
        p_correlacion IN VARCHAR2
    ) IS
    BEGIN
        INSERT INTO auditoria_evento (
            id_actor, id_sesion, id_comando, ocurrido_en, accion,
            tipo_recurso, identificador_recurso, motivo, correlacion
        ) VALUES (
            p_actor, p_sesion, p_id_comando, p_ahora, p_accion,
            'CITA', TO_CHAR(p_id_cita), p_motivo, p_correlacion
        );
    END auditar;

    PROCEDURE solicitar_cita (
        p_ambito IN VARCHAR2,
        p_clave_idempotencia IN VARCHAR2,
        p_solicitud_hash IN RAW,
        p_id_actor IN NUMBER,
        p_id_sesion IN NUMBER,
        p_correlacion IN VARCHAR2,
        p_id_vehiculo IN NUMBER,
        p_origen IN VARCHAR2,
        p_id_qr_origen IN NUMBER,
        p_nombre_solicitante IN VARCHAR2,
        p_contacto_solicitante IN VARCHAR2,
        p_motivo IN VARCHAR2,
        p_inicio_solicitado IN TIMESTAMP WITH TIME ZONE,
        p_id_cita OUT NUMBER,
        p_version OUT NUMBER,
        p_repetido OUT NUMBER
    ) IS
        l_id_comando NUMBER;
        l_resultado CLOB;
        l_ahora TIMESTAMP(6) WITH TIME ZONE := SYSTIMESTAMP;
        l_tipo_actor VARCHAR2(10);
        l_id_cliente NUMBER;
        l_nombre cita.nombre_solicitante%TYPE;
        l_contacto cita.contacto_solicitante%TYPE;
        l_id_usuario cita.id_usuario_solicita%TYPE;
        l_dummy NUMBER;
    BEGIN
        SAVEPOINT i03_agenda_operation;
        abrir_comando(
            p_ambito, p_clave_idempotencia, p_solicitud_hash,
            'SOLICITAR_CITA', p_id_actor, p_id_sesion,
            l_id_comando, l_resultado, p_repetido
        );
        IF p_repetido = 1 THEN
            p_id_cita := JSON_VALUE(l_resultado, '$.citaId' RETURNING NUMBER);
            p_version := JSON_VALUE(l_resultado, '$.version' RETURNING NUMBER);
            RETURN;
        END IF;

        IF p_origen = 'CUENTA' THEN
            bloquear_actor(p_id_actor, p_id_sesion, l_tipo_actor, l_id_cliente);
            IF l_tipo_actor <> 'CLIENTE' THEN
                RAISE_APPLICATION_ERROR(-20012, 'ORIGEN_CUENTA_INVALIDO');
            END IF;
            SELECT nombre, COALESCE(email, telefono)
            INTO l_nombre, l_contacto
            FROM cliente
            WHERE id_cliente = l_id_cliente
              AND activo = 1
            FOR UPDATE;
            l_id_usuario := p_id_actor;
        ELSIF p_origen = 'PERSONAL' THEN
            exigir_gestor(p_id_actor, p_id_sesion);
            l_nombre := TRIM(p_nombre_solicitante);
            l_contacto := TRIM(p_contacto_solicitante);
            l_id_usuario := NULL;
        ELSIF p_origen = 'QR' THEN
            IF p_id_actor IS NOT NULL OR p_id_sesion IS NOT NULL THEN
                RAISE_APPLICATION_ERROR(-20013, 'ORIGEN_QR_INVALIDO');
            END IF;
            l_nombre := TRIM(p_nombre_solicitante);
            l_contacto := TRIM(p_contacto_solicitante);
            l_id_usuario := NULL;
        ELSE
            RAISE_APPLICATION_ERROR(-20014, 'ORIGEN_INVALIDO');
        END IF;

        BEGIN
            SELECT 1 INTO l_dummy
            FROM vehiculo
            WHERE id_vehiculo = p_id_vehiculo
              AND activo = 1
            FOR UPDATE;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RAISE_APPLICATION_ERROR(-20015, 'VEHICULO_NO_DISPONIBLE');
        END;

        IF p_origen = 'CUENTA' THEN
            BEGIN
                SELECT 1 INTO l_dummy
                FROM propiedad_vehiculo
                WHERE id_vehiculo = p_id_vehiculo
                  AND id_cliente = l_id_cliente
                  AND hasta_en IS NULL;
            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    RAISE_APPLICATION_ERROR(-20016, 'VEHICULO_AJENO');
            END;
        ELSIF p_origen = 'QR' THEN
            BEGIN
                SELECT 1 INTO l_dummy
                FROM qr_token
                WHERE id_qr = p_id_qr_origen
                  AND id_vehiculo = p_id_vehiculo
                  AND revocado_en IS NULL
                  AND (expira_en IS NULL OR expira_en > l_ahora)
                FOR UPDATE;
            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    RAISE_APPLICATION_ERROR(-20017, 'QR_NO_DISPONIBLE');
            END;
        END IF;

        INSERT INTO cita (
            id_vehiculo, origen, id_usuario_solicita, id_qr_origen,
            nombre_solicitante, contacto_solicitante, motivo,
            solicitada_en, inicio_solicitado, estado, version_fila
        ) VALUES (
            p_id_vehiculo, p_origen, l_id_usuario, p_id_qr_origen,
            l_nombre, l_contacto, TRIM(p_motivo),
            l_ahora, p_inicio_solicitado, 'SOLICITADA', 1
        ) RETURNING id_cita, version_fila INTO p_id_cita, p_version;

        INSERT INTO cita_evento (
            id_cita, tipo, estado_nuevo, inicio_nuevo, motivo,
            registrado_en, registrado_por, id_comando
        ) VALUES (
            p_id_cita, 'SOLICITUD', 'SOLICITADA', p_inicio_solicitado,
            'Solicitud de cita', l_ahora, p_id_actor, l_id_comando
        );

        completar_comando(l_id_comando, p_id_cita, p_version, 'SOLICITADA', 201, l_resultado);
        auditar(p_id_actor, p_id_sesion, l_id_comando, l_ahora,
                'SOLICITAR_CITA', p_id_cita, 'Solicitud de cita', p_correlacion);
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK TO i03_agenda_operation;
            RAISE;
    END solicitar_cita;

    PROCEDURE confirmar_cita (
        p_ambito IN VARCHAR2, p_clave_idempotencia IN VARCHAR2,
        p_solicitud_hash IN RAW, p_id_actor IN NUMBER, p_id_sesion IN NUMBER,
        p_correlacion IN VARCHAR2, p_id_cita IN NUMBER,
        p_version_esperada IN NUMBER, p_inicio IN TIMESTAMP WITH TIME ZONE,
        p_fin IN TIMESTAMP WITH TIME ZONE, p_motivo IN VARCHAR2,
        p_version OUT NUMBER, p_repetido OUT NUMBER
    ) IS
        l_id_comando NUMBER; l_resultado CLOB;
        l_ahora TIMESTAMP(6) WITH TIME ZONE := SYSTIMESTAMP;
        l_id_vehiculo NUMBER; l_estado cita.estado%TYPE; l_version NUMBER;
        l_dummy NUMBER;
    BEGIN
        SAVEPOINT i03_agenda_operation;
        abrir_comando(p_ambito,p_clave_idempotencia,p_solicitud_hash,'CONFIRMAR_CITA',p_id_actor,p_id_sesion,l_id_comando,l_resultado,p_repetido);
        IF p_repetido=1 THEN p_version:=JSON_VALUE(l_resultado,'$.version' RETURNING NUMBER); RETURN; END IF;
        exigir_gestor(p_id_actor,p_id_sesion);
        IF p_fin IS NULL OR p_inicio IS NULL OR p_fin <= p_inicio THEN RAISE_APPLICATION_ERROR(-20020,'HORARIO_INVALIDO'); END IF;
        BEGIN SELECT id_vehiculo INTO l_id_vehiculo FROM cita WHERE id_cita=p_id_cita;
        EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20021,'CITA_NO_ENCONTRADA'); END;
        SELECT 1 INTO l_dummy FROM vehiculo WHERE id_vehiculo=l_id_vehiculo FOR UPDATE;
        SELECT estado,version_fila INTO l_estado,l_version FROM cita WHERE id_cita=p_id_cita FOR UPDATE;
        IF l_version<>p_version_esperada THEN RAISE_APPLICATION_ERROR(-20022,'VERSION_DESACTUALIZADA'); END IF;
        IF l_estado<>'SOLICITADA' THEN RAISE_APPLICATION_ERROR(-20023,'ESTADO_INCOMPATIBLE'); END IF;
        UPDATE cita SET estado='CONFIRMADA',inicio_programado=p_inicio,fin_programado=p_fin,version_fila=version_fila+1 WHERE id_cita=p_id_cita;
        p_version:=l_version+1;
        INSERT INTO cita_evento(id_cita,tipo,estado_anterior,estado_nuevo,inicio_nuevo,fin_nuevo,motivo,registrado_en,registrado_por,id_comando)
          VALUES(p_id_cita,'ESTADO','SOLICITADA','CONFIRMADA',p_inicio,p_fin,TRIM(p_motivo),l_ahora,p_id_actor,l_id_comando);
        completar_comando(l_id_comando,p_id_cita,p_version,'CONFIRMADA',200,l_resultado);
        auditar(p_id_actor,p_id_sesion,l_id_comando,l_ahora,'CONFIRMAR_CITA',p_id_cita,p_motivo,p_correlacion);
    EXCEPTION WHEN OTHERS THEN ROLLBACK TO i03_agenda_operation; RAISE;
    END confirmar_cita;

    PROCEDURE reprogramar_cita (
        p_ambito IN VARCHAR2, p_clave_idempotencia IN VARCHAR2,
        p_solicitud_hash IN RAW, p_id_actor IN NUMBER, p_id_sesion IN NUMBER,
        p_correlacion IN VARCHAR2, p_id_cita IN NUMBER,
        p_version_esperada IN NUMBER, p_inicio IN TIMESTAMP WITH TIME ZONE,
        p_fin IN TIMESTAMP WITH TIME ZONE, p_motivo IN VARCHAR2,
        p_version OUT NUMBER, p_repetido OUT NUMBER
    ) IS
        l_id_comando NUMBER; l_resultado CLOB;
        l_ahora TIMESTAMP(6) WITH TIME ZONE:=SYSTIMESTAMP;
        l_id_vehiculo NUMBER; l_estado cita.estado%TYPE; l_version NUMBER;
        l_inicio_solicitado cita.inicio_solicitado%TYPE;
        l_inicio_programado cita.inicio_programado%TYPE;
        l_fin_programado cita.fin_programado%TYPE; l_dummy NUMBER;
    BEGIN
        SAVEPOINT i03_agenda_operation;
        abrir_comando(p_ambito,p_clave_idempotencia,p_solicitud_hash,'REPROGRAMAR_CITA',p_id_actor,p_id_sesion,l_id_comando,l_resultado,p_repetido);
        IF p_repetido=1 THEN p_version:=JSON_VALUE(l_resultado,'$.version' RETURNING NUMBER); RETURN; END IF;
        exigir_gestor(p_id_actor,p_id_sesion);
        IF p_inicio IS NULL THEN RAISE_APPLICATION_ERROR(-20020,'HORARIO_INVALIDO'); END IF;
        BEGIN SELECT id_vehiculo INTO l_id_vehiculo FROM cita WHERE id_cita=p_id_cita;
        EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20021,'CITA_NO_ENCONTRADA'); END;
        SELECT 1 INTO l_dummy FROM vehiculo WHERE id_vehiculo=l_id_vehiculo FOR UPDATE;
        SELECT estado,version_fila,inicio_solicitado,inicio_programado,fin_programado
          INTO l_estado,l_version,l_inicio_solicitado,l_inicio_programado,l_fin_programado
          FROM cita WHERE id_cita=p_id_cita FOR UPDATE;
        IF l_version<>p_version_esperada THEN RAISE_APPLICATION_ERROR(-20022,'VERSION_DESACTUALIZADA'); END IF;
        IF l_estado NOT IN ('SOLICITADA','CONFIRMADA') THEN RAISE_APPLICATION_ERROR(-20023,'ESTADO_INCOMPATIBLE'); END IF;
        IF l_estado='SOLICITADA' THEN
            IF p_fin IS NOT NULL THEN RAISE_APPLICATION_ERROR(-20020,'HORARIO_INVALIDO'); END IF;
            UPDATE cita SET inicio_solicitado=p_inicio,version_fila=version_fila+1 WHERE id_cita=p_id_cita;
            INSERT INTO cita_evento(id_cita,tipo,estado_anterior,estado_nuevo,inicio_anterior,inicio_nuevo,motivo,registrado_en,registrado_por,id_comando)
              VALUES(p_id_cita,'REPROGRAMACION','SOLICITADA','SOLICITADA',l_inicio_solicitado,p_inicio,TRIM(p_motivo),l_ahora,p_id_actor,l_id_comando);
        ELSE
            IF p_fin IS NULL OR p_fin<=p_inicio THEN RAISE_APPLICATION_ERROR(-20020,'HORARIO_INVALIDO'); END IF;
            UPDATE cita SET inicio_programado=p_inicio,fin_programado=p_fin,version_fila=version_fila+1 WHERE id_cita=p_id_cita;
            INSERT INTO cita_evento(id_cita,tipo,estado_anterior,estado_nuevo,inicio_anterior,fin_anterior,inicio_nuevo,fin_nuevo,motivo,registrado_en,registrado_por,id_comando)
              VALUES(p_id_cita,'REPROGRAMACION','CONFIRMADA','CONFIRMADA',l_inicio_programado,l_fin_programado,p_inicio,p_fin,TRIM(p_motivo),l_ahora,p_id_actor,l_id_comando);
        END IF;
        p_version:=l_version+1;
        completar_comando(l_id_comando,p_id_cita,p_version,l_estado,200,l_resultado);
        auditar(p_id_actor,p_id_sesion,l_id_comando,l_ahora,'REPROGRAMAR_CITA',p_id_cita,p_motivo,p_correlacion);
    EXCEPTION WHEN OTHERS THEN ROLLBACK TO i03_agenda_operation; RAISE;
    END reprogramar_cita;

    PROCEDURE cambiar_estado (
        p_ambito IN VARCHAR2, p_clave IN VARCHAR2, p_hash IN RAW,
        p_actor IN NUMBER, p_sesion IN NUMBER, p_correlacion IN VARCHAR2,
        p_id_cita IN NUMBER, p_version_esperada IN NUMBER,
        p_destino IN VARCHAR2, p_tipo_operacion IN VARCHAR2,
        p_motivo IN VARCHAR2, p_exigir_fin_pasado IN NUMBER,
        p_admitir_cliente IN NUMBER, p_version OUT NUMBER, p_repetido OUT NUMBER
    ) IS
        l_id_comando NUMBER; l_resultado CLOB;
        l_ahora TIMESTAMP(6) WITH TIME ZONE:=SYSTIMESTAMP;
        l_id_vehiculo NUMBER; l_estado cita.estado%TYPE; l_origen cita.origen%TYPE;
        l_solicitante NUMBER; l_version NUMBER; l_fin cita.fin_programado%TYPE;
        l_tipo_actor VARCHAR2(10); l_cliente NUMBER; l_dummy NUMBER;
    BEGIN
        SAVEPOINT i03_agenda_operation;
        abrir_comando(p_ambito,p_clave,p_hash,p_tipo_operacion,p_actor,p_sesion,l_id_comando,l_resultado,p_repetido);
        IF p_repetido=1 THEN p_version:=JSON_VALUE(l_resultado,'$.version' RETURNING NUMBER); RETURN; END IF;
        bloquear_actor(p_actor,p_sesion,l_tipo_actor,l_cliente);
        BEGIN SELECT id_vehiculo INTO l_id_vehiculo FROM cita WHERE id_cita=p_id_cita;
        EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20021,'CITA_NO_ENCONTRADA'); END;
        SELECT 1 INTO l_dummy FROM vehiculo WHERE id_vehiculo=l_id_vehiculo FOR UPDATE;
        SELECT estado,origen,id_usuario_solicita,version_fila,fin_programado
          INTO l_estado,l_origen,l_solicitante,l_version,l_fin
          FROM cita WHERE id_cita=p_id_cita FOR UPDATE;
        IF l_tipo_actor='INTERNO' THEN
            IF NOT (tiene_rol(p_actor,'ADMINISTRADOR') OR tiene_rol(p_actor,'RECEPCIONISTA')) THEN RAISE_APPLICATION_ERROR(-20011,'ROL_REQUERIDO'); END IF;
        ELSIF p_admitir_cliente=1 AND l_tipo_actor='CLIENTE' AND l_origen='CUENTA' AND l_solicitante=p_actor THEN
            NULL;
        ELSE
            RAISE_APPLICATION_ERROR(-20011,'ROL_REQUERIDO');
        END IF;
        IF l_version<>p_version_esperada THEN RAISE_APPLICATION_ERROR(-20022,'VERSION_DESACTUALIZADA'); END IF;
        IF p_destino='CANCELADA' THEN
            IF l_estado NOT IN ('SOLICITADA','CONFIRMADA') THEN RAISE_APPLICATION_ERROR(-20023,'ESTADO_INCOMPATIBLE'); END IF;
        ELSE
            IF l_estado<>'CONFIRMADA' THEN RAISE_APPLICATION_ERROR(-20023,'ESTADO_INCOMPATIBLE'); END IF;
        END IF;
        IF p_exigir_fin_pasado=1 AND l_fin>SYSTIMESTAMP THEN RAISE_APPLICATION_ERROR(-20020,'HORARIO_INVALIDO'); END IF;
        UPDATE cita SET estado=p_destino,version_fila=version_fila+1 WHERE id_cita=p_id_cita;
        p_version:=l_version+1;
        INSERT INTO cita_evento(id_cita,tipo,estado_anterior,estado_nuevo,motivo,registrado_en,registrado_por,id_comando)
          VALUES(p_id_cita,'ESTADO',l_estado,p_destino,TRIM(p_motivo),l_ahora,p_actor,l_id_comando);
        completar_comando(l_id_comando,p_id_cita,p_version,p_destino,200,l_resultado);
        auditar(p_actor,p_sesion,l_id_comando,l_ahora,p_tipo_operacion,p_id_cita,p_motivo,p_correlacion);
    EXCEPTION WHEN OTHERS THEN ROLLBACK TO i03_agenda_operation; RAISE;
    END cambiar_estado;

    PROCEDURE cancelar_cita (
        p_ambito IN VARCHAR2, p_clave_idempotencia IN VARCHAR2, p_solicitud_hash IN RAW,
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER, p_correlacion IN VARCHAR2,
        p_id_cita IN NUMBER, p_version_esperada IN NUMBER, p_motivo IN VARCHAR2,
        p_version OUT NUMBER, p_repetido OUT NUMBER
    ) IS BEGIN
        cambiar_estado(p_ambito,p_clave_idempotencia,p_solicitud_hash,p_id_actor,p_id_sesion,p_correlacion,p_id_cita,p_version_esperada,'CANCELADA','CANCELAR_CITA',p_motivo,0,1,p_version,p_repetido);
    END cancelar_cita;

    PROCEDURE registrar_inasistencia (
        p_ambito IN VARCHAR2, p_clave_idempotencia IN VARCHAR2, p_solicitud_hash IN RAW,
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER, p_correlacion IN VARCHAR2,
        p_id_cita IN NUMBER, p_version_esperada IN NUMBER, p_motivo IN VARCHAR2,
        p_version OUT NUMBER, p_repetido OUT NUMBER
    ) IS BEGIN
        cambiar_estado(p_ambito,p_clave_idempotencia,p_solicitud_hash,p_id_actor,p_id_sesion,p_correlacion,p_id_cita,p_version_esperada,'NO_ASISTIO','REGISTRAR_INASISTENCIA',p_motivo,1,0,p_version,p_repetido);
    END registrar_inasistencia;

    PROCEDURE atender_sin_orden (
        p_ambito IN VARCHAR2, p_clave_idempotencia IN VARCHAR2, p_solicitud_hash IN RAW,
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER, p_correlacion IN VARCHAR2,
        p_id_cita IN NUMBER, p_version_esperada IN NUMBER, p_motivo IN VARCHAR2,
        p_version OUT NUMBER, p_repetido OUT NUMBER
    ) IS BEGIN
        cambiar_estado(p_ambito,p_clave_idempotencia,p_solicitud_hash,p_id_actor,p_id_sesion,p_correlacion,p_id_cita,p_version_esperada,'ATENDIDA','ATENDER_SIN_ORDEN',p_motivo,0,0,p_version,p_repetido);
    END atender_sin_orden;
END pkg_agenda;
/
