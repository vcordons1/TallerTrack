CREATE OR REPLACE PACKAGE pkg_vehiculos AUTHID DEFINER AS
    PROCEDURE registrar_vehiculo (
        p_ambito IN VARCHAR2,
        p_clave_idempotencia IN VARCHAR2,
        p_solicitud_hash IN RAW,
        p_id_actor IN NUMBER,
        p_id_sesion IN NUMBER,
        p_correlacion IN VARCHAR2,
        p_id_cliente IN NUMBER,
        p_codigo_tipo IN VARCHAR2,
        p_placa IN VARCHAR2,
        p_vin IN VARCHAR2,
        p_marca IN VARCHAR2,
        p_modelo IN VARCHAR2,
        p_anio IN NUMBER,
        p_color IN VARCHAR2,
        p_motivo_propiedad IN VARCHAR2,
        p_token_hash IN RAW,
        p_expira_en IN TIMESTAMP WITH TIME ZONE,
        p_id_vehiculo OUT NUMBER,
        p_id_propiedad OUT NUMBER,
        p_id_qr OUT NUMBER,
        p_repetido OUT NUMBER
    );

    PROCEDURE transferir_propiedad (
        p_ambito IN VARCHAR2,
        p_clave_idempotencia IN VARCHAR2,
        p_solicitud_hash IN RAW,
        p_id_actor IN NUMBER,
        p_id_sesion IN NUMBER,
        p_correlacion IN VARCHAR2,
        p_id_vehiculo IN NUMBER,
        p_propiedad_esperada IN NUMBER,
        p_cliente_esperado IN NUMBER,
        p_nuevo_cliente IN NUMBER,
        p_motivo IN VARCHAR2,
        p_nuevo_token_hash IN RAW,
        p_expira_en IN TIMESTAMP WITH TIME ZONE,
        p_propiedad_anterior OUT NUMBER,
        p_propiedad_actual OUT NUMBER,
        p_id_qr OUT NUMBER,
        p_repetido OUT NUMBER
    );

    PROCEDURE rotar_qr (
        p_ambito IN VARCHAR2,
        p_clave_idempotencia IN VARCHAR2,
        p_solicitud_hash IN RAW,
        p_id_actor IN NUMBER,
        p_id_sesion IN NUMBER,
        p_correlacion IN VARCHAR2,
        p_id_vehiculo IN NUMBER,
        p_generacion_esperada IN NUMBER,
        p_motivo IN VARCHAR2,
        p_nuevo_token_hash IN RAW,
        p_expira_en IN TIMESTAMP WITH TIME ZONE,
        p_id_qr OUT NUMBER,
        p_repetido OUT NUMBER
    );
END pkg_vehiculos;
/

CREATE OR REPLACE PACKAGE BODY pkg_vehiculos AS
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
        p_sesion IN NUMBER
    ) IS
        l_dummy NUMBER;
    BEGIN
        SELECT 1 INTO l_dummy
        FROM usuario
        WHERE id_usuario = p_actor
        FOR UPDATE;

        IF p_sesion IS NOT NULL THEN
            SELECT 1 INTO l_dummy
            FROM sesion
            WHERE id_sesion = p_sesion
              AND id_usuario = p_actor
            FOR UPDATE;
        END IF;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20010, 'ACTOR_O_SESION_INVALIDO');
    END bloquear_actor;

    PROCEDURE registrar_vehiculo (
        p_ambito IN VARCHAR2,
        p_clave_idempotencia IN VARCHAR2,
        p_solicitud_hash IN RAW,
        p_id_actor IN NUMBER,
        p_id_sesion IN NUMBER,
        p_correlacion IN VARCHAR2,
        p_id_cliente IN NUMBER,
        p_codigo_tipo IN VARCHAR2,
        p_placa IN VARCHAR2,
        p_vin IN VARCHAR2,
        p_marca IN VARCHAR2,
        p_modelo IN VARCHAR2,
        p_anio IN NUMBER,
        p_color IN VARCHAR2,
        p_motivo_propiedad IN VARCHAR2,
        p_token_hash IN RAW,
        p_expira_en IN TIMESTAMP WITH TIME ZONE,
        p_id_vehiculo OUT NUMBER,
        p_id_propiedad OUT NUMBER,
        p_id_qr OUT NUMBER,
        p_repetido OUT NUMBER
    ) IS
        l_id_comando NUMBER;
        l_resultado CLOB;
        l_ahora TIMESTAMP(6) WITH TIME ZONE := SYSTIMESTAMP;
        l_dummy NUMBER;
    BEGIN
        SAVEPOINT i02_operation;
        abrir_comando(
            p_ambito, p_clave_idempotencia, p_solicitud_hash,
            'REGISTRAR_VEHICULO', p_id_actor, p_id_sesion,
            l_id_comando, l_resultado, p_repetido
        );
        IF p_repetido = 1 THEN
            p_id_vehiculo := JSON_VALUE(l_resultado, '$.vehiculoId' RETURNING NUMBER);
            p_id_propiedad := JSON_VALUE(l_resultado, '$.propiedadId' RETURNING NUMBER);
            p_id_qr := JSON_VALUE(l_resultado, '$.qrId' RETURNING NUMBER);
            RETURN;
        END IF;

        bloquear_actor(p_id_actor, p_id_sesion);
        BEGIN
            SELECT 1 INTO l_dummy
            FROM cliente
            WHERE id_cliente = p_id_cliente
              AND activo = 1
            FOR UPDATE;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RAISE_APPLICATION_ERROR(-20011, 'CLIENTE_NO_DISPONIBLE');
        END;

        INSERT INTO vehiculo (
            codigo_tipo, placa, vin, marca, modelo, anio, color, activo,
            creado_en, creado_por, actualizado_en, actualizado_por, version_fila
        ) VALUES (
            p_codigo_tipo, TRIM(p_placa), TRIM(p_vin), TRIM(p_marca),
            TRIM(p_modelo), p_anio, TRIM(p_color), 1,
            l_ahora, p_id_actor, l_ahora, p_id_actor, 1
        ) RETURNING id_vehiculo INTO p_id_vehiculo;

        INSERT INTO propiedad_vehiculo (
            id_vehiculo, id_cliente, desde_en, motivo,
            registrado_por, id_comando
        ) VALUES (
            p_id_vehiculo, p_id_cliente, l_ahora, p_motivo_propiedad,
            p_id_actor, l_id_comando
        ) RETURNING id_propiedad INTO p_id_propiedad;

        INSERT INTO qr_token (
            id_vehiculo, token_hash, emitido_en, emitido_por,
            expira_en, id_comando
        ) VALUES (
            p_id_vehiculo, p_token_hash, l_ahora, p_id_actor,
            p_expira_en, l_id_comando
        ) RETURNING id_qr INTO p_id_qr;

        l_resultado := JSON_OBJECT(
            'vehiculoId' VALUE TO_CHAR(p_id_vehiculo),
            'propiedadId' VALUE TO_CHAR(p_id_propiedad),
            'qrId' VALUE TO_CHAR(p_id_qr)
        );
        UPDATE comando
        SET resultado_codigo = 201,
            resultado_minimo = l_resultado
        WHERE id_comando = l_id_comando;

        INSERT INTO auditoria_evento (
            id_actor, id_sesion, id_comando, ocurrido_en, accion,
            tipo_recurso, identificador_recurso, motivo, cambios, correlacion
        ) VALUES (
            p_id_actor, p_id_sesion, l_id_comando, l_ahora, 'REGISTRAR_VEHICULO',
            'VEHICULO', TO_CHAR(p_id_vehiculo), p_motivo_propiedad,
            JSON_OBJECT('propiedadId' VALUE TO_CHAR(p_id_propiedad),
                        'qrId' VALUE TO_CHAR(p_id_qr)),
            p_correlacion
        );
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK TO i02_operation;
            RAISE;
    END registrar_vehiculo;

    PROCEDURE transferir_propiedad (
        p_ambito IN VARCHAR2,
        p_clave_idempotencia IN VARCHAR2,
        p_solicitud_hash IN RAW,
        p_id_actor IN NUMBER,
        p_id_sesion IN NUMBER,
        p_correlacion IN VARCHAR2,
        p_id_vehiculo IN NUMBER,
        p_propiedad_esperada IN NUMBER,
        p_cliente_esperado IN NUMBER,
        p_nuevo_cliente IN NUMBER,
        p_motivo IN VARCHAR2,
        p_nuevo_token_hash IN RAW,
        p_expira_en IN TIMESTAMP WITH TIME ZONE,
        p_propiedad_anterior OUT NUMBER,
        p_propiedad_actual OUT NUMBER,
        p_id_qr OUT NUMBER,
        p_repetido OUT NUMBER
    ) IS
        l_id_comando NUMBER;
        l_resultado CLOB;
        l_ahora TIMESTAMP(6) WITH TIME ZONE := SYSTIMESTAMP;
        l_count NUMBER := 0;
        l_nuevo_activo NUMBER := 0;
        l_actual_propiedad NUMBER;
        l_actual_cliente NUMBER;
        l_actual_qr NUMBER;
        l_dummy NUMBER;
    BEGIN
        SAVEPOINT i02_operation;
        abrir_comando(
            p_ambito, p_clave_idempotencia, p_solicitud_hash,
            'TRANSFERIR_PROPIEDAD', p_id_actor, p_id_sesion,
            l_id_comando, l_resultado, p_repetido
        );
        IF p_repetido = 1 THEN
            p_propiedad_anterior := JSON_VALUE(l_resultado, '$.propiedadAnteriorId' RETURNING NUMBER);
            p_propiedad_actual := JSON_VALUE(l_resultado, '$.propiedadActualId' RETURNING NUMBER);
            p_id_qr := JSON_VALUE(l_resultado, '$.qrId' RETURNING NUMBER);
            RETURN;
        END IF;

        bloquear_actor(p_id_actor, p_id_sesion);
        FOR r IN (
            SELECT id_cliente, activo
            FROM cliente
            WHERE id_cliente IN (p_cliente_esperado, p_nuevo_cliente)
            ORDER BY id_cliente
            FOR UPDATE
        ) LOOP
            l_count := l_count + 1;
            IF r.id_cliente = p_nuevo_cliente AND r.activo = 1 THEN
                l_nuevo_activo := 1;
            END IF;
        END LOOP;
        IF p_cliente_esperado = p_nuevo_cliente THEN
            RAISE_APPLICATION_ERROR(-20020, 'PROPIETARIO_DESTINO_IGUAL');
        END IF;
        IF l_count <> 2 OR l_nuevo_activo <> 1 THEN
            RAISE_APPLICATION_ERROR(-20011, 'CLIENTE_NO_DISPONIBLE');
        END IF;

        BEGIN
            SELECT 1 INTO l_dummy
            FROM vehiculo
            WHERE id_vehiculo = p_id_vehiculo
            FOR UPDATE;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RAISE_APPLICATION_ERROR(-20012, 'VEHICULO_NO_ENCONTRADO');
        END;

        BEGIN
            SELECT id_propiedad, id_cliente
            INTO l_actual_propiedad, l_actual_cliente
            FROM propiedad_vehiculo
            WHERE id_vehiculo = p_id_vehiculo
              AND hasta_en IS NULL
            FOR UPDATE;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RAISE_APPLICATION_ERROR(-20021, 'PROPIEDAD_CAMBIADA');
        END;
        IF l_actual_propiedad <> p_propiedad_esperada
           OR l_actual_cliente <> p_cliente_esperado THEN
            RAISE_APPLICATION_ERROR(-20021, 'PROPIEDAD_CAMBIADA');
        END IF;

        BEGIN
            SELECT id_qr INTO l_actual_qr
            FROM qr_token
            WHERE id_vehiculo = p_id_vehiculo
              AND revocado_en IS NULL
            FOR UPDATE;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RAISE_APPLICATION_ERROR(-20030, 'QR_NO_VIGENTE');
        END;

        UPDATE propiedad_vehiculo
        SET hasta_en = l_ahora,
            cerrado_por = p_id_actor
        WHERE id_propiedad = l_actual_propiedad;

        INSERT INTO propiedad_vehiculo (
            id_vehiculo, id_cliente, desde_en, motivo, registrado_por,
            id_predecesora, id_comando
        ) VALUES (
            p_id_vehiculo, p_nuevo_cliente, l_ahora, p_motivo, p_id_actor,
            l_actual_propiedad, l_id_comando
        ) RETURNING id_propiedad INTO p_propiedad_actual;
        p_propiedad_anterior := l_actual_propiedad;

        UPDATE qr_token
        SET revocado_en = l_ahora,
            revocado_por = p_id_actor,
            motivo_revocacion = p_motivo
        WHERE id_qr = l_actual_qr;

        INSERT INTO qr_token (
            id_vehiculo, token_hash, emitido_en, emitido_por,
            expira_en, id_comando
        ) VALUES (
            p_id_vehiculo, p_nuevo_token_hash, l_ahora, p_id_actor,
            p_expira_en, l_id_comando
        ) RETURNING id_qr INTO p_id_qr;

        l_resultado := JSON_OBJECT(
            'vehiculoId' VALUE TO_CHAR(p_id_vehiculo),
            'propiedadAnteriorId' VALUE TO_CHAR(p_propiedad_anterior),
            'propiedadActualId' VALUE TO_CHAR(p_propiedad_actual),
            'qrId' VALUE TO_CHAR(p_id_qr)
        );
        UPDATE comando
        SET resultado_codigo = 200,
            resultado_minimo = l_resultado
        WHERE id_comando = l_id_comando;

        INSERT INTO auditoria_evento (
            id_actor, id_sesion, id_comando, ocurrido_en, accion,
            tipo_recurso, identificador_recurso, motivo, cambios, correlacion
        ) VALUES (
            p_id_actor, p_id_sesion, l_id_comando, l_ahora, 'TRANSFERIR_PROPIEDAD',
            'VEHICULO', TO_CHAR(p_id_vehiculo), p_motivo,
            JSON_OBJECT('propiedadAnteriorId' VALUE TO_CHAR(p_propiedad_anterior),
                        'propiedadActualId' VALUE TO_CHAR(p_propiedad_actual),
                        'qrId' VALUE TO_CHAR(p_id_qr)),
            p_correlacion
        );
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK TO i02_operation;
            RAISE;
    END transferir_propiedad;

    PROCEDURE rotar_qr (
        p_ambito IN VARCHAR2,
        p_clave_idempotencia IN VARCHAR2,
        p_solicitud_hash IN RAW,
        p_id_actor IN NUMBER,
        p_id_sesion IN NUMBER,
        p_correlacion IN VARCHAR2,
        p_id_vehiculo IN NUMBER,
        p_generacion_esperada IN NUMBER,
        p_motivo IN VARCHAR2,
        p_nuevo_token_hash IN RAW,
        p_expira_en IN TIMESTAMP WITH TIME ZONE,
        p_id_qr OUT NUMBER,
        p_repetido OUT NUMBER
    ) IS
        l_id_comando NUMBER;
        l_resultado CLOB;
        l_ahora TIMESTAMP(6) WITH TIME ZONE := SYSTIMESTAMP;
        l_actual_qr NUMBER;
        l_dummy NUMBER;
    BEGIN
        SAVEPOINT i02_operation;
        abrir_comando(
            p_ambito, p_clave_idempotencia, p_solicitud_hash,
            'ROTAR_QR', p_id_actor, p_id_sesion,
            l_id_comando, l_resultado, p_repetido
        );
        IF p_repetido = 1 THEN
            p_id_qr := JSON_VALUE(l_resultado, '$.qrId' RETURNING NUMBER);
            RETURN;
        END IF;

        bloquear_actor(p_id_actor, p_id_sesion);
        BEGIN
            SELECT 1 INTO l_dummy
            FROM vehiculo
            WHERE id_vehiculo = p_id_vehiculo
            FOR UPDATE;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RAISE_APPLICATION_ERROR(-20012, 'VEHICULO_NO_ENCONTRADO');
        END;

        BEGIN
            SELECT id_qr INTO l_actual_qr
            FROM qr_token
            WHERE id_vehiculo = p_id_vehiculo
              AND revocado_en IS NULL
            FOR UPDATE;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                l_actual_qr := NULL;
        END;

        IF NVL(l_actual_qr, -1) <> NVL(p_generacion_esperada, -1) THEN
            RAISE_APPLICATION_ERROR(-20031, 'QR_GENERACION_CAMBIADA');
        END IF;

        IF l_actual_qr IS NOT NULL THEN
            UPDATE qr_token
            SET revocado_en = l_ahora,
                revocado_por = p_id_actor,
                motivo_revocacion = p_motivo
            WHERE id_qr = l_actual_qr;
        END IF;

        INSERT INTO qr_token (
            id_vehiculo, token_hash, emitido_en, emitido_por,
            expira_en, id_comando
        ) VALUES (
            p_id_vehiculo, p_nuevo_token_hash, l_ahora, p_id_actor,
            p_expira_en, l_id_comando
        ) RETURNING id_qr INTO p_id_qr;

        l_resultado := JSON_OBJECT(
            'vehiculoId' VALUE TO_CHAR(p_id_vehiculo),
            'qrId' VALUE TO_CHAR(p_id_qr)
        );
        UPDATE comando
        SET resultado_codigo = 200,
            resultado_minimo = l_resultado
        WHERE id_comando = l_id_comando;

        INSERT INTO auditoria_evento (
            id_actor, id_sesion, id_comando, ocurrido_en, accion,
            tipo_recurso, identificador_recurso, motivo, cambios, correlacion
        ) VALUES (
            p_id_actor, p_id_sesion, l_id_comando, l_ahora, 'ROTAR_QR',
            'VEHICULO', TO_CHAR(p_id_vehiculo), p_motivo,
            JSON_OBJECT('generacionAnteriorId' VALUE TO_CHAR(l_actual_qr),
                        'generacionActualId' VALUE TO_CHAR(p_id_qr)),
            p_correlacion
        );
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK TO i02_operation;
            RAISE;
    END rotar_qr;
END pkg_vehiculos;
/
