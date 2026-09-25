CREATE OR REPLACE PACKAGE pkg_consultas_clientes_vehiculos AUTHID DEFINER AS
    PROCEDURE listar_clientes (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER,
        p_q IN VARCHAR2, p_activo IN NUMBER,
        p_despues_creado_en IN VARCHAR2, p_despues_id IN NUMBER,
        p_limite IN NUMBER, p_resultado OUT SYS_REFCURSOR
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

    PROCEDURE listar_clientes (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER,
        p_q IN VARCHAR2, p_activo IN NUMBER,
        p_despues_creado_en IN VARCHAR2, p_despues_id IN NUMBER,
        p_limite IN NUMBER, p_resultado OUT SYS_REFCURSOR
    ) IS
        l_despues TIMESTAMP WITH TIME ZONE;
    BEGIN
        exigir_recepcion(p_id_actor, p_id_sesion);
        IF p_despues_creado_en IS NOT NULL THEN
            l_despues := TO_TIMESTAMP_TZ(REPLACE(p_despues_creado_en, 'Z', '+00:00'), 'YYYY-MM-DD"T"HH24:MI:SS.FF6TZH:TZM');
        END IF;
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
                 WHERE (p_activo IS NULL OR c.activo = p_activo)
                   AND (p_q IS NULL OR INSTR(UPPER(c.nombre), UPPER(p_q)) > 0
                        OR INSTR(UPPER(NVL(c.telefono, '')), UPPER(p_q)) > 0
                        OR INSTR(UPPER(NVL(c.email, '')), UPPER(p_q)) > 0
                        OR INSTR(UPPER(NVL(c.nit, '')), UPPER(p_q)) > 0)
                   AND (l_despues IS NULL OR c.creado_en < l_despues
                        OR (c.creado_en = l_despues AND c.id_cliente < p_despues_id))
                 ORDER BY c.creado_en DESC, c.id_cliente DESC
            ) WHERE ROWNUM <= p_limite;
    END listar_clientes;

    PROCEDURE abrir_vehiculos (
        p_q IN VARCHAR2, p_id_cliente IN NUMBER, p_activo IN NUMBER,
        p_despues_creado_en IN VARCHAR2, p_despues_id IN NUMBER,
        p_id_vehiculo IN NUMBER, p_limite IN NUMBER,
        p_resultado OUT SYS_REFCURSOR
    ) IS
        l_despues TIMESTAMP WITH TIME ZONE;
    BEGIN
        IF p_despues_creado_en IS NOT NULL THEN
            l_despues := TO_TIMESTAMP_TZ(REPLACE(p_despues_creado_en, 'Z', '+00:00'), 'YYYY-MM-DD"T"HH24:MI:SS.FF6TZH:TZM');
        END IF;
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
END pkg_consultas_clientes_vehiculos;
/

CREATE OR REPLACE PACKAGE pkg_consultas_ordenes AUTHID DEFINER AS
    PROCEDURE listar_recepcion (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER, p_desde IN VARCHAR2, p_hasta IN VARCHAR2,
        p_estado IN VARCHAR2, p_proposito IN VARCHAR2, p_id_vehiculo IN NUMBER, p_activas IN NUMBER,
        p_despues_ingresado_en IN VARCHAR2, p_despues_id IN NUMBER, p_limite IN NUMBER,
        p_resultado OUT SYS_REFCURSOR
    );
    PROCEDURE listar_tecnica (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER, p_desde IN VARCHAR2, p_hasta IN VARCHAR2,
        p_estado IN VARCHAR2, p_proposito IN VARCHAR2, p_id_vehiculo IN NUMBER, p_activas IN NUMBER,
        p_despues_ingresado_en IN VARCHAR2, p_despues_id IN NUMBER, p_limite IN NUMBER,
        p_resultado OUT SYS_REFCURSOR
    );
    PROCEDURE listar_inventario (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER, p_desde IN VARCHAR2, p_hasta IN VARCHAR2,
        p_estado IN VARCHAR2, p_proposito IN VARCHAR2, p_id_vehiculo IN NUMBER, p_activas IN NUMBER,
        p_despues_ingresado_en IN VARCHAR2, p_despues_id IN NUMBER, p_limite IN NUMBER,
        p_resultado OUT SYS_REFCURSOR
    );
    PROCEDURE consultar_recepcion (p_id_actor IN NUMBER, p_id_sesion IN NUMBER, p_id_orden IN NUMBER, p_resultado OUT SYS_REFCURSOR);
    PROCEDURE consultar_tecnica (p_id_actor IN NUMBER, p_id_sesion IN NUMBER, p_id_orden IN NUMBER, p_resultado OUT SYS_REFCURSOR);
    PROCEDURE consultar_inventario (p_id_actor IN NUMBER, p_id_sesion IN NUMBER, p_id_orden IN NUMBER, p_resultado OUT SYS_REFCURSOR);
END pkg_consultas_ordenes;
/

CREATE OR REPLACE PACKAGE BODY pkg_consultas_ordenes AS
    PROCEDURE exigir_rol (p_id_actor IN NUMBER, p_id_sesion IN NUMBER, p_vista IN VARCHAR2) IS
        l_valido NUMBER;
    BEGIN
        SELECT COUNT(*) INTO l_valido
          FROM usuario u JOIN sesion s ON s.id_usuario = u.id_usuario
         WHERE u.id_usuario = p_id_actor AND u.tipo_actor = 'INTERNO' AND u.activo = 1
           AND s.id_sesion = p_id_sesion AND s.version_credencial = u.version_credencial
           AND s.revocada_en IS NULL AND s.expira_en > SYSTIMESTAMP
           AND EXISTS (SELECT 1 FROM usuario_rol ur
                        WHERE ur.id_usuario = u.id_usuario AND ur.retirado_en IS NULL
                          AND ((p_vista = 'RECEPCION' AND ur.codigo_rol IN ('ADMINISTRADOR','RECEPCIONISTA'))
                            OR (p_vista = 'TECNICA' AND ur.codigo_rol = 'MECANICO')
                            OR (p_vista = 'INVENTARIO' AND ur.codigo_rol = 'INVENTARIO')));
        IF l_valido <> 1 THEN RAISE_APPLICATION_ERROR(-20011, 'ROL_CONSULTA_REQUERIDO'); END IF;
    END exigir_rol;

    PROCEDURE fechas(p_desde IN VARCHAR2, p_hasta IN VARCHAR2, p_despues IN VARCHAR2,
                     o_desde OUT TIMESTAMP WITH TIME ZONE, o_hasta OUT TIMESTAMP WITH TIME ZONE,
                     o_despues OUT TIMESTAMP WITH TIME ZONE) IS
    BEGIN
        IF p_desde IS NOT NULL THEN o_desde := TO_TIMESTAMP_TZ(REPLACE(p_desde, 'Z', '+00:00'), 'YYYY-MM-DD"T"HH24:MI:SS.FF6TZH:TZM'); END IF;
        IF p_hasta IS NOT NULL THEN o_hasta := TO_TIMESTAMP_TZ(REPLACE(p_hasta, 'Z', '+00:00'), 'YYYY-MM-DD"T"HH24:MI:SS.FF6TZH:TZM'); END IF;
        IF p_despues IS NOT NULL THEN o_despues := TO_TIMESTAMP_TZ(REPLACE(p_despues, 'Z', '+00:00'), 'YYYY-MM-DD"T"HH24:MI:SS.FF6TZH:TZM'); END IF;
    END fechas;

    PROCEDURE listar_recepcion (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER, p_desde IN VARCHAR2, p_hasta IN VARCHAR2,
        p_estado IN VARCHAR2, p_proposito IN VARCHAR2, p_id_vehiculo IN NUMBER, p_activas IN NUMBER,
        p_despues_ingresado_en IN VARCHAR2, p_despues_id IN NUMBER, p_limite IN NUMBER,
        p_resultado OUT SYS_REFCURSOR
    ) IS l_desde TIMESTAMP WITH TIME ZONE; l_hasta TIMESTAMP WITH TIME ZONE; l_despues TIMESTAMP WITH TIME ZONE;
    BEGIN
        exigir_rol(p_id_actor,p_id_sesion,'RECEPCION'); fechas(p_desde,p_hasta,p_despues_ingresado_en,l_desde,l_hasta,l_despues);
        OPEN p_resultado FOR SELECT * FROM (
            SELECT TO_CHAR(o.id_orden,'FM999999999999999999') id, TO_CHAR(o.version_fila,'FM9999999999') version,
                   TO_CHAR(v.id_vehiculo,'FM999999999999999999') vehiculo_id, v.codigo_tipo, v.placa, v.vin, v.marca, v.modelo, v.anio, v.color, v.activo vehiculo_activo,
                   o.proposito,o.estado,TO_CHAR(o.ingresado_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') ingresado_en,
                   TO_CHAR(o.kilometraje_ingreso,'FM9999999990D0','NLS_NUMERIC_CHARACTERS=''.,''') kilometraje_ingreso,
                   o.motivo_ingreso,o.danos_visibles,o.motivo_cierre,
                   CASE WHEN o.listo_en IS NULL THEN NULL ELSE TO_CHAR(o.listo_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') END listo_en,
                   CASE WHEN o.entregado_en IS NULL THEN NULL ELSE TO_CHAR(o.entregado_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') END entregado_en,
                   CASE WHEN o.kilometraje_entrega IS NULL THEN NULL ELSE TO_CHAR(o.kilometraje_entrega,'FM9999999990D0','NLS_NUMERIC_CHARACTERS=''.,''') END kilometraje_entrega,
                   o.entregado_a, TO_CHAR(c.id_cliente,'FM999999999999999999') cliente_id,c.nombre cliente_nombre,
                   TO_CHAR(o.id_propiedad_apertura,'FM999999999999999999') propiedad_apertura_id,
                   TO_CHAR(o.id_cita,'FM999999999999999999') cita_id,
                   TO_CHAR(SYSTIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') calculado_en,
                   TO_CHAR(o.ingresado_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') posicion_fecha,
                   TO_CHAR(o.id_orden,'FM999999999999999999') posicion_id
              FROM orden_trabajo o JOIN vehiculo v ON v.id_vehiculo=o.id_vehiculo JOIN cliente c ON c.id_cliente=o.id_cliente
             WHERE (l_desde IS NULL OR o.ingresado_en>=l_desde) AND (l_hasta IS NULL OR o.ingresado_en<l_hasta)
               AND (p_estado IS NULL OR o.estado=p_estado) AND (p_proposito IS NULL OR o.proposito=p_proposito)
               AND (p_id_vehiculo IS NULL OR o.id_vehiculo=p_id_vehiculo)
               AND (p_activas IS NULL OR (p_activas=1 AND o.estado NOT IN ('ENTREGADO','ENTREGADO_SIN_REPARACION','CANCELADO')) OR (p_activas=0 AND o.estado IN ('ENTREGADO','ENTREGADO_SIN_REPARACION','CANCELADO')))
               AND (l_despues IS NULL OR o.ingresado_en<l_despues OR (o.ingresado_en=l_despues AND o.id_orden<p_despues_id))
             ORDER BY o.ingresado_en DESC,o.id_orden DESC
        ) WHERE ROWNUM<=p_limite;
    END listar_recepcion;

    PROCEDURE listar_tecnica (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER, p_desde IN VARCHAR2, p_hasta IN VARCHAR2,
        p_estado IN VARCHAR2, p_proposito IN VARCHAR2, p_id_vehiculo IN NUMBER, p_activas IN NUMBER,
        p_despues_ingresado_en IN VARCHAR2, p_despues_id IN NUMBER, p_limite IN NUMBER,
        p_resultado OUT SYS_REFCURSOR
    ) IS l_desde TIMESTAMP WITH TIME ZONE; l_hasta TIMESTAMP WITH TIME ZONE; l_despues TIMESTAMP WITH TIME ZONE;
    BEGIN
        exigir_rol(p_id_actor,p_id_sesion,'TECNICA'); fechas(p_desde,p_hasta,p_despues_ingresado_en,l_desde,l_hasta,l_despues);
        OPEN p_resultado FOR SELECT * FROM (
            SELECT TO_CHAR(o.id_orden,'FM999999999999999999') id, TO_CHAR(o.version_fila,'FM9999999999') version,
                   TO_CHAR(v.id_vehiculo,'FM999999999999999999') vehiculo_id, v.codigo_tipo, v.placa, v.vin, v.marca, v.modelo, v.anio, v.color, v.activo vehiculo_activo,
                   o.proposito,o.estado,TO_CHAR(o.ingresado_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') ingresado_en,
                   TO_CHAR(o.kilometraje_ingreso,'FM9999999990D0','NLS_NUMERIC_CHARACTERS=''.,''') kilometraje_ingreso,
                   o.motivo_ingreso,o.danos_visibles,o.motivo_cierre,
                   CASE WHEN o.listo_en IS NULL THEN NULL ELSE TO_CHAR(o.listo_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') END listo_en,
                   CASE WHEN o.entregado_en IS NULL THEN NULL ELSE TO_CHAR(o.entregado_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') END entregado_en,
                   CASE WHEN o.kilometraje_entrega IS NULL THEN NULL ELSE TO_CHAR(o.kilometraje_entrega,'FM9999999990D0','NLS_NUMERIC_CHARACTERS=''.,''') END kilometraje_entrega,
                   o.entregado_a, TO_CHAR(o.ingresado_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') posicion_fecha,
                   TO_CHAR(o.id_orden,'FM999999999999999999') posicion_id
              FROM orden_trabajo o JOIN vehiculo v ON v.id_vehiculo=o.id_vehiculo
             WHERE EXISTS (SELECT 1 FROM orden_mecanico om WHERE om.id_orden=o.id_orden AND om.id_mecanico=p_id_actor AND om.retirado_en IS NULL)
               AND (l_desde IS NULL OR o.ingresado_en>=l_desde) AND (l_hasta IS NULL OR o.ingresado_en<l_hasta)
               AND (p_estado IS NULL OR o.estado=p_estado) AND (p_proposito IS NULL OR o.proposito=p_proposito)
               AND (p_id_vehiculo IS NULL OR o.id_vehiculo=p_id_vehiculo)
               AND (p_activas IS NULL OR (p_activas=1 AND o.estado NOT IN ('ENTREGADO','ENTREGADO_SIN_REPARACION','CANCELADO')) OR (p_activas=0 AND o.estado IN ('ENTREGADO','ENTREGADO_SIN_REPARACION','CANCELADO')))
               AND (l_despues IS NULL OR o.ingresado_en<l_despues OR (o.ingresado_en=l_despues AND o.id_orden<p_despues_id))
             ORDER BY o.ingresado_en DESC,o.id_orden DESC
        ) WHERE ROWNUM<=p_limite;
    END listar_tecnica;

    PROCEDURE listar_inventario (
        p_id_actor IN NUMBER, p_id_sesion IN NUMBER, p_desde IN VARCHAR2, p_hasta IN VARCHAR2,
        p_estado IN VARCHAR2, p_proposito IN VARCHAR2, p_id_vehiculo IN NUMBER, p_activas IN NUMBER,
        p_despues_ingresado_en IN VARCHAR2, p_despues_id IN NUMBER, p_limite IN NUMBER,
        p_resultado OUT SYS_REFCURSOR
    ) IS l_desde TIMESTAMP WITH TIME ZONE; l_hasta TIMESTAMP WITH TIME ZONE; l_despues TIMESTAMP WITH TIME ZONE;
    BEGIN
        exigir_rol(p_id_actor,p_id_sesion,'INVENTARIO'); fechas(p_desde,p_hasta,p_despues_ingresado_en,l_desde,l_hasta,l_despues);
        OPEN p_resultado FOR SELECT * FROM (
            SELECT TO_CHAR(o.id_orden,'FM999999999999999999') id,TO_CHAR(o.version_fila,'FM9999999999') version,o.estado,o.proposito,
                   TO_CHAR(o.ingresado_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') posicion_fecha,
                   TO_CHAR(o.id_orden,'FM999999999999999999') posicion_id
              FROM orden_trabajo o
             WHERE (l_desde IS NULL OR o.ingresado_en>=l_desde) AND (l_hasta IS NULL OR o.ingresado_en<l_hasta)
               AND (p_estado IS NULL OR o.estado=p_estado) AND (p_proposito IS NULL OR o.proposito=p_proposito)
               AND (p_id_vehiculo IS NULL OR o.id_vehiculo=p_id_vehiculo)
               AND (p_activas IS NULL OR (p_activas=1 AND o.estado NOT IN ('ENTREGADO','ENTREGADO_SIN_REPARACION','CANCELADO')) OR (p_activas=0 AND o.estado IN ('ENTREGADO','ENTREGADO_SIN_REPARACION','CANCELADO')))
               AND (l_despues IS NULL OR o.ingresado_en<l_despues OR (o.ingresado_en=l_despues AND o.id_orden<p_despues_id))
             ORDER BY o.ingresado_en DESC,o.id_orden DESC
        ) WHERE ROWNUM<=p_limite;
    END listar_inventario;

    PROCEDURE consultar_recepcion (p_id_actor IN NUMBER,p_id_sesion IN NUMBER,p_id_orden IN NUMBER,p_resultado OUT SYS_REFCURSOR) IS BEGIN
        exigir_rol(p_id_actor,p_id_sesion,'RECEPCION');
        OPEN p_resultado FOR SELECT TO_CHAR(o.id_orden,'FM999999999999999999') id,TO_CHAR(o.version_fila,'FM9999999999') version,
            TO_CHAR(v.id_vehiculo,'FM999999999999999999') vehiculo_id,v.codigo_tipo,v.placa,v.vin,v.marca,v.modelo,v.anio,v.color,v.activo vehiculo_activo,
            o.proposito,o.estado,TO_CHAR(o.ingresado_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') ingresado_en,
            TO_CHAR(o.kilometraje_ingreso,'FM9999999990D0','NLS_NUMERIC_CHARACTERS=''.,''') kilometraje_ingreso,o.motivo_ingreso,o.danos_visibles,o.motivo_cierre,
            CASE WHEN o.listo_en IS NULL THEN NULL ELSE TO_CHAR(o.listo_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') END listo_en,
            CASE WHEN o.entregado_en IS NULL THEN NULL ELSE TO_CHAR(o.entregado_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') END entregado_en,
            CASE WHEN o.kilometraje_entrega IS NULL THEN NULL ELSE TO_CHAR(o.kilometraje_entrega,'FM9999999990D0','NLS_NUMERIC_CHARACTERS=''.,''') END kilometraje_entrega,o.entregado_a,
            TO_CHAR(c.id_cliente,'FM999999999999999999') cliente_id,c.nombre cliente_nombre,TO_CHAR(o.id_propiedad_apertura,'FM999999999999999999') propiedad_apertura_id,
            TO_CHAR(o.id_cita,'FM999999999999999999') cita_id,TO_CHAR(SYSTIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') calculado_en
          FROM orden_trabajo o JOIN vehiculo v ON v.id_vehiculo=o.id_vehiculo JOIN cliente c ON c.id_cliente=o.id_cliente WHERE o.id_orden=p_id_orden;
    END consultar_recepcion;
    PROCEDURE consultar_tecnica (p_id_actor IN NUMBER,p_id_sesion IN NUMBER,p_id_orden IN NUMBER,p_resultado OUT SYS_REFCURSOR) IS BEGIN
        exigir_rol(p_id_actor,p_id_sesion,'TECNICA');
        OPEN p_resultado FOR SELECT TO_CHAR(o.id_orden,'FM999999999999999999') id,TO_CHAR(o.version_fila,'FM9999999999') version,
            TO_CHAR(v.id_vehiculo,'FM999999999999999999') vehiculo_id,v.codigo_tipo,v.placa,v.vin,v.marca,v.modelo,v.anio,v.color,v.activo vehiculo_activo,
            o.proposito,o.estado,TO_CHAR(o.ingresado_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') ingresado_en,
            TO_CHAR(o.kilometraje_ingreso,'FM9999999990D0','NLS_NUMERIC_CHARACTERS=''.,''') kilometraje_ingreso,o.motivo_ingreso,o.danos_visibles,o.motivo_cierre,
            CASE WHEN o.listo_en IS NULL THEN NULL ELSE TO_CHAR(o.listo_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') END listo_en,
            CASE WHEN o.entregado_en IS NULL THEN NULL ELSE TO_CHAR(o.entregado_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') END entregado_en,
            CASE WHEN o.kilometraje_entrega IS NULL THEN NULL ELSE TO_CHAR(o.kilometraje_entrega,'FM9999999990D0','NLS_NUMERIC_CHARACTERS=''.,''') END kilometraje_entrega,o.entregado_a
          FROM orden_trabajo o JOIN vehiculo v ON v.id_vehiculo=o.id_vehiculo WHERE o.id_orden=p_id_orden
           AND EXISTS (SELECT 1 FROM orden_mecanico om WHERE om.id_orden=o.id_orden AND om.id_mecanico=p_id_actor AND om.retirado_en IS NULL);
    END consultar_tecnica;
    PROCEDURE consultar_inventario (p_id_actor IN NUMBER,p_id_sesion IN NUMBER,p_id_orden IN NUMBER,p_resultado OUT SYS_REFCURSOR) IS BEGIN
        exigir_rol(p_id_actor,p_id_sesion,'INVENTARIO');
        OPEN p_resultado FOR SELECT TO_CHAR(id_orden,'FM999999999999999999') id,TO_CHAR(version_fila,'FM9999999999') version,estado,proposito
          FROM orden_trabajo WHERE id_orden=p_id_orden;
    END consultar_inventario;
END pkg_consultas_ordenes;
/
