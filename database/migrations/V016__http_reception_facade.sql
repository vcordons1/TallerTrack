CREATE OR REPLACE PACKAGE pkg_recepcion_http AUTHID DEFINER AS
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
        p_repetido OUT NUMBER,
        p_id_comando OUT NUMBER,
        p_confirmado_en OUT VARCHAR2
    );
END pkg_recepcion_http;
/

CREATE OR REPLACE PACKAGE BODY pkg_recepcion_http AS
    PROCEDURE exigir_recepcionista (
        p_id_actor IN NUMBER,
        p_id_sesion IN NUMBER
    ) IS
        l_tipo usuario.tipo_actor%TYPE;
        l_rol NUMBER;
        l_dummy NUMBER;
    BEGIN
        SELECT tipo_actor INTO l_tipo
        FROM usuario
        WHERE id_usuario = p_id_actor
          AND activo = 1
        FOR UPDATE;

        IF p_id_sesion IS NOT NULL THEN
            SELECT 1 INTO l_dummy
            FROM sesion
            WHERE id_sesion = p_id_sesion
              AND id_usuario = p_id_actor
              AND revocada_en IS NULL
              AND expira_en > SYSTIMESTAMP
            FOR UPDATE;
        END IF;

        SELECT COUNT(*) INTO l_rol
        FROM usuario_rol
        WHERE id_usuario = p_id_actor
          AND codigo_rol = 'RECEPCIONISTA'
          AND retirado_en IS NULL;

        IF l_tipo <> 'INTERNO' OR l_rol <> 1 THEN
            RAISE_APPLICATION_ERROR(-20011, 'ROL_RECEPCIONISTA_REQUERIDO');
        END IF;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20010, 'ACTOR_O_SESION_INVALIDO');
    END exigir_recepcionista;

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
        p_repetido OUT NUMBER,
        p_id_comando OUT NUMBER,
        p_confirmado_en OUT VARCHAR2
    ) IS
        l_registrado_en comando.registrado_en%TYPE;
    BEGIN
        pkg_ordenes.abrir_orden_comercial(
            p_ambito, p_clave_idempotencia, p_solicitud_hash,
            p_id_actor, p_id_sesion, p_correlacion,
            p_id_vehiculo, p_propiedad_esperada, p_propietario_esperado,
            p_kilometraje_ingreso, p_motivo_ingreso, p_danos_visibles,
            p_evidencias_json, p_id_orden, p_estado, p_version,
            p_id_cliente, p_id_propiedad, p_evidencias_ids_json, p_repetido
        );

        SELECT id_comando, registrado_en
        INTO p_id_comando, l_registrado_en
        FROM comando
        WHERE ambito = p_ambito
          AND clave_idempotencia = p_clave_idempotencia
          AND tipo_operacion = 'ABRIR_ORDEN_COMERCIAL'
          AND id_actor = p_id_actor
          AND NVL(id_sesion, -1) = NVL(p_id_sesion, -1)
        FOR UPDATE;

        -- T01 already checks this for a new intention. Rechecking here also
        -- protects replay when a role or session changed after the first commit.
        exigir_recepcionista(p_id_actor, p_id_sesion);
        p_confirmado_en := TO_CHAR(
            l_registrado_en AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"'
        );
    END abrir_orden_comercial;
END pkg_recepcion_http;
/
