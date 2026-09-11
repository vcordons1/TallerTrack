CREATE OR REPLACE PACKAGE pkg_ordenes AUTHID DEFINER AS
    PROCEDURE abrir_orden_comercial (
        p_ambito IN VARCHAR2,
        p_clave_idempotencia IN VARCHAR2,
        p_solicitud_hash IN RAW,
        p_id_actor IN NUMBER,
        p_id_sesion IN NUMBER,
        p_correlacion IN VARCHAR2,
        p_id_vehiculo IN NUMBER,
        p_propiedad_esperada IN NUMBER,
        p_propietario_esperado IN NUMBER,
        p_kilometraje_ingreso IN NUMBER,
        p_motivo_ingreso IN VARCHAR2,
        p_danos_visibles IN VARCHAR2,
        p_evidencias_json IN CLOB,
        p_id_orden OUT NUMBER,
        p_estado OUT VARCHAR2,
        p_version OUT NUMBER,
        p_id_cliente OUT NUMBER,
        p_id_propiedad OUT NUMBER,
        p_evidencias_ids_json OUT VARCHAR2,
        p_repetido OUT NUMBER
    );
END pkg_ordenes;
/

CREATE OR REPLACE PACKAGE BODY pkg_ordenes AS
    PROCEDURE abrir_comando (
        p_ambito IN VARCHAR2,
        p_clave IN VARCHAR2,
        p_hash IN RAW,
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
                p_ambito, p_clave, p_hash, 'ABRIR_ORDEN_COMERCIAL',
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
                   OR l_tipo <> 'ABRIR_ORDEN_COMERCIAL'
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

    PROCEDURE exigir_recepcionista (
        p_actor IN NUMBER,
        p_sesion IN NUMBER
    ) IS
        l_tipo usuario.tipo_actor%TYPE;
        l_rol NUMBER;
        l_dummy NUMBER;
    BEGIN
        SELECT tipo_actor INTO l_tipo
        FROM usuario
        WHERE id_usuario = p_actor
          AND activo = 1
        FOR UPDATE;

        IF p_sesion IS NOT NULL THEN
            SELECT 1 INTO l_dummy
            FROM sesion
            WHERE id_sesion = p_sesion
              AND id_usuario = p_actor
              AND revocada_en IS NULL
              AND expira_en > SYSTIMESTAMP
            FOR UPDATE;
        END IF;

        SELECT COUNT(*) INTO l_rol
        FROM usuario_rol
        WHERE id_usuario = p_actor
          AND codigo_rol = 'RECEPCIONISTA'
          AND retirado_en IS NULL;

        IF l_tipo <> 'INTERNO' OR l_rol <> 1 THEN
            RAISE_APPLICATION_ERROR(-20011, 'ROL_RECEPCIONISTA_REQUERIDO');
        END IF;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20010, 'ACTOR_O_SESION_INVALIDO');
    END exigir_recepcionista;

    PROCEDURE validar_evidencias (
        p_evidencias_json IN CLOB,
        p_cantidad OUT NUMBER
    ) IS
        l_invalidas NUMBER;
    BEGIN
        IF p_evidencias_json IS NULL
           OR NOT REGEXP_LIKE(DBMS_LOB.SUBSTR(p_evidencias_json, 4000, 1), '^\s*\[') THEN
            RAISE_APPLICATION_ERROR(-20040, 'EVIDENCIA_INVALIDA');
        END IF;

        SELECT COUNT(*),
               NVL(SUM(CASE
                   WHEN clave_objeto IS NULL OR NOT REGEXP_LIKE(clave_objeto, '^[0-9a-f]{32}$')
                     OR mime_type NOT IN ('image/jpeg', 'image/png')
                     OR tamano_bytes IS NULL OR tamano_bytes <= 0
                     OR sha256_hex IS NULL OR NOT REGEXP_LIKE(sha256_hex, '^[0-9a-f]{64}$')
                     OR intencion_carga IS NULL OR LENGTH(intencion_carga) > 100
                     OR descripcion IS NULL OR LENGTH(TRIM(descripcion)) = 0 OR LENGTH(descripcion) > 1000
                   THEN 1 ELSE 0 END), 0)
        INTO p_cantidad, l_invalidas
        FROM JSON_TABLE(
            p_evidencias_json,
            '$[*]' COLUMNS (
                clave_objeto VARCHAR2(300 CHAR) PATH '$.objectKey' ERROR ON ERROR,
                mime_type VARCHAR2(100 CHAR) PATH '$.mimeType' ERROR ON ERROR,
                tamano_bytes NUMBER(14,0) PATH '$.sizeBytes' ERROR ON ERROR,
                sha256_hex VARCHAR2(64 CHAR) PATH '$.sha256' ERROR ON ERROR,
                intencion_carga VARCHAR2(100 CHAR) PATH '$.intentId' ERROR ON ERROR,
                descripcion VARCHAR2(1000 CHAR) PATH '$.description' ERROR ON ERROR
            )
        );

        IF p_cantidad < 1 THEN
            RAISE_APPLICATION_ERROR(-20041, 'EVIDENCIA_REQUERIDA');
        END IF;
        IF p_cantidad > 100 OR l_invalidas <> 0 THEN
            RAISE_APPLICATION_ERROR(-20040, 'EVIDENCIA_INVALIDA');
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLCODE BETWEEN -20099 AND -20000 THEN RAISE; END IF;
            RAISE_APPLICATION_ERROR(-20040, 'EVIDENCIA_INVALIDA');
    END validar_evidencias;

    PROCEDURE abrir_orden_comercial (
        p_ambito IN VARCHAR2,
        p_clave_idempotencia IN VARCHAR2,
        p_solicitud_hash IN RAW,
        p_id_actor IN NUMBER,
        p_id_sesion IN NUMBER,
        p_correlacion IN VARCHAR2,
        p_id_vehiculo IN NUMBER,
        p_propiedad_esperada IN NUMBER,
        p_propietario_esperado IN NUMBER,
        p_kilometraje_ingreso IN NUMBER,
        p_motivo_ingreso IN VARCHAR2,
        p_danos_visibles IN VARCHAR2,
        p_evidencias_json IN CLOB,
        p_id_orden OUT NUMBER,
        p_estado OUT VARCHAR2,
        p_version OUT NUMBER,
        p_id_cliente OUT NUMBER,
        p_id_propiedad OUT NUMBER,
        p_evidencias_ids_json OUT VARCHAR2,
        p_repetido OUT NUMBER
    ) IS
        l_id_comando NUMBER;
        l_resultado CLOB;
        l_ahora TIMESTAMP(6) WITH TIME ZONE := SYSTIMESTAMP;
        l_cantidad NUMBER;
        l_activo NUMBER;
        l_propiedad NUMBER;
        l_cliente NUMBER;
        l_previas_entregadas NUMBER;
        l_activas NUMBER;
        l_id_archivo NUMBER;
        l_id_evidencia NUMBER;
    BEGIN
        SAVEPOINT t01_operation;
        abrir_comando(
            p_ambito, p_clave_idempotencia, p_solicitud_hash,
            p_id_actor, p_id_sesion, l_id_comando, l_resultado, p_repetido
        );
        IF p_repetido = 1 THEN
            p_id_orden := JSON_VALUE(l_resultado, '$.ordenId' RETURNING NUMBER);
            p_estado := JSON_VALUE(l_resultado, '$.estado' RETURNING VARCHAR2(40));
            p_version := JSON_VALUE(l_resultado, '$.version' RETURNING NUMBER);
            p_id_cliente := JSON_VALUE(l_resultado, '$.clienteContractualId' RETURNING NUMBER);
            p_id_propiedad := JSON_VALUE(l_resultado, '$.propiedadAperturaId' RETURNING NUMBER);
            p_evidencias_ids_json := JSON_QUERY(l_resultado, '$.evidenciasIds' RETURNING VARCHAR2(4000));
            RETURN;
        END IF;

        exigir_recepcionista(p_id_actor, p_id_sesion);

        BEGIN
            SELECT activo INTO l_activo
            FROM cliente
            WHERE id_cliente = p_propietario_esperado
            FOR UPDATE;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RAISE_APPLICATION_ERROR(-20012, 'CLIENTE_NO_DISPONIBLE');
        END;
        IF l_activo <> 1 THEN
            RAISE_APPLICATION_ERROR(-20012, 'CLIENTE_NO_DISPONIBLE');
        END IF;

        BEGIN
            SELECT activo INTO l_activo
            FROM vehiculo
            WHERE id_vehiculo = p_id_vehiculo
            FOR UPDATE;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RAISE_APPLICATION_ERROR(-20013, 'VEHICULO_NO_ENCONTRADO');
        END;
        IF l_activo <> 1 THEN
            RAISE_APPLICATION_ERROR(-20014, 'VEHICULO_NO_DISPONIBLE');
        END IF;

        BEGIN
            SELECT id_propiedad, id_cliente
            INTO l_propiedad, l_cliente
            FROM propiedad_vehiculo
            WHERE id_vehiculo = p_id_vehiculo
              AND hasta_en IS NULL
            FOR UPDATE;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RAISE_APPLICATION_ERROR(-20021, 'PROPIEDAD_CAMBIADA');
        END;
        IF l_propiedad <> p_propiedad_esperada
           OR l_cliente <> p_propietario_esperado THEN
            RAISE_APPLICATION_ERROR(-20021, 'PROPIEDAD_CAMBIADA');
        END IF;
        p_id_cliente := l_cliente;
        p_id_propiedad := l_propiedad;

        SELECT COUNT(*) INTO l_activas
        FROM orden_trabajo
        WHERE id_vehiculo = p_id_vehiculo
          AND estado IN (
              'RECIBIDO', 'EN_DIAGNOSTICO', 'ESPERANDO_AUTORIZACION',
              'EN_REPARACION', 'LISTO_PARA_ENTREGA',
              'PENDIENTE_ENTREGA_SIN_REPARACION'
          );
        IF l_activas <> 0 THEN
            RAISE_APPLICATION_ERROR(-20030, 'ORDEN_ACTIVA_EXISTENTE');
        END IF;

        SELECT COUNT(*) INTO l_previas_entregadas
        FROM orden_trabajo
        WHERE id_cliente = l_cliente
          AND estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION');
        IF l_previas_entregadas <> 0 THEN
            RAISE_APPLICATION_ERROR(-20031, 'DEUDA_NO_VERIFICABLE');
        END IF;

        validar_evidencias(p_evidencias_json, l_cantidad);

        IF p_kilometraje_ingreso IS NULL OR p_kilometraje_ingreso < 0
           OR p_motivo_ingreso IS NULL OR LENGTH(TRIM(p_motivo_ingreso)) = 0 OR LENGTH(p_motivo_ingreso) > 2000
           OR p_danos_visibles IS NULL OR LENGTH(TRIM(p_danos_visibles)) = 0 OR LENGTH(p_danos_visibles) > 2000 THEN
            RAISE_APPLICATION_ERROR(-20032, 'RECEPCION_INVALIDA');
        END IF;

        INSERT INTO orden_trabajo (
            id_vehiculo, id_propiedad_apertura, id_cliente, id_cita,
            proposito, ingresado_en, kilometraje_ingreso, motivo_ingreso,
            danos_visibles, estado, version_fila, creado_por, id_comando
        ) VALUES (
            p_id_vehiculo, l_propiedad, l_cliente, NULL,
            'COMERCIAL', l_ahora, p_kilometraje_ingreso, TRIM(p_motivo_ingreso),
            TRIM(p_danos_visibles), 'RECIBIDO', 1, p_id_actor, l_id_comando
        ) RETURNING id_orden, estado, version_fila
          INTO p_id_orden, p_estado, p_version;

        INSERT INTO orden_evento (
            id_orden, tipo, estado_anterior, estado_nuevo, motivo, detalle,
            registrado_en, registrado_por, id_comando
        ) VALUES (
            p_id_orden, 'APERTURA', NULL, 'RECIBIDO', 'Recepcion de llegada directa',
            JSON_OBJECT('proposito' VALUE 'COMERCIAL',
                        'cantidadEvidencias' VALUE l_cantidad),
            l_ahora, p_id_actor, l_id_comando
        );

        p_evidencias_ids_json := '[';
        FOR r IN (
            SELECT orden, clave_objeto, mime_type, tamano_bytes,
                   sha256_hex, intencion_carga, descripcion
            FROM JSON_TABLE(
                p_evidencias_json,
                '$[*]' COLUMNS (
                    orden FOR ORDINALITY,
                    clave_objeto VARCHAR2(300 CHAR) PATH '$.objectKey' ERROR ON ERROR,
                    mime_type VARCHAR2(100 CHAR) PATH '$.mimeType' ERROR ON ERROR,
                    tamano_bytes NUMBER(14,0) PATH '$.sizeBytes' ERROR ON ERROR,
                    sha256_hex VARCHAR2(64 CHAR) PATH '$.sha256' ERROR ON ERROR,
                    intencion_carga VARCHAR2(100 CHAR) PATH '$.intentId' ERROR ON ERROR,
                    descripcion VARCHAR2(1000 CHAR) PATH '$.description' ERROR ON ERROR
                )
            )
            ORDER BY orden
        ) LOOP
            BEGIN
                INSERT INTO archivo_privado (
                    clave_objeto, mime_type, tamano_bytes, sha256,
                    creado_en, creado_por, intencion_carga
                ) VALUES (
                    r.clave_objeto, r.mime_type, r.tamano_bytes,
                    HEXTORAW(r.sha256_hex), l_ahora, p_id_actor, r.intencion_carga
                ) RETURNING id_archivo INTO l_id_archivo;
            EXCEPTION
                WHEN DUP_VAL_ON_INDEX THEN
                    RAISE_APPLICATION_ERROR(-20047, 'OBJETO_YA_CONSUMIDO');
            END;

            INSERT INTO evidencia (
                id_orden, id_archivo, contexto, visibilidad, descripcion,
                registrado_en, registrado_por, id_comando
            ) VALUES (
                p_id_orden, l_id_archivo, 'RECEPCION', 'CLIENTE_ATENCION',
                TRIM(r.descripcion), l_ahora, p_id_actor, l_id_comando
            ) RETURNING id_evidencia INTO l_id_evidencia;

            IF r.orden > 1 THEN p_evidencias_ids_json := p_evidencias_ids_json || ','; END IF;
            p_evidencias_ids_json := p_evidencias_ids_json || TO_CHAR(l_id_evidencia);
        END LOOP;
        p_evidencias_ids_json := p_evidencias_ids_json || ']';

        l_resultado := '{"ordenId":' || TO_CHAR(p_id_orden)
            || ',"estado":"RECIBIDO","version":' || TO_CHAR(p_version)
            || ',"clienteContractualId":' || TO_CHAR(l_cliente)
            || ',"propiedadAperturaId":' || TO_CHAR(l_propiedad)
            || ',"evidenciasIds":' || p_evidencias_ids_json || '}';
        UPDATE comando
        SET resultado_codigo = 201,
            resultado_minimo = l_resultado
        WHERE id_comando = l_id_comando;

        INSERT INTO auditoria_evento (
            id_actor, id_sesion, id_comando, ocurrido_en, accion,
            tipo_recurso, identificador_recurso, motivo, cambios, correlacion
        ) VALUES (
            p_id_actor, p_id_sesion, l_id_comando, l_ahora,
            'ABRIR_ORDEN_COMERCIAL', 'ORDEN_TRABAJO', TO_CHAR(p_id_orden),
            'Apertura comercial de llegada directa',
            JSON_OBJECT('estado' VALUE 'RECIBIDO',
                        'propiedadAperturaId' VALUE TO_CHAR(l_propiedad),
                        'cantidadEvidencias' VALUE l_cantidad),
            p_correlacion
        );
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK TO t01_operation;
            RAISE;
    END abrir_orden_comercial;
END pkg_ordenes;
/
