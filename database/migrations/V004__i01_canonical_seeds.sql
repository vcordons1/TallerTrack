MERGE INTO rol destino
USING (
    SELECT 'ADMINISTRADOR' codigo_rol, 'Administrador' nombre FROM dual
    UNION ALL SELECT 'RECEPCIONISTA', 'Recepcionista' FROM dual
    UNION ALL SELECT 'MECANICO', 'Mecanico' FROM dual
    UNION ALL SELECT 'INVENTARIO', 'Inventario' FROM dual
    UNION ALL SELECT 'CLIENTE', 'Cliente' FROM dual
) fuente
ON (destino.codigo_rol = fuente.codigo_rol)
WHEN NOT MATCHED THEN
    INSERT (codigo_rol, nombre)
    VALUES (fuente.codigo_rol, fuente.nombre);

MERGE INTO config_taller destino
USING (
    SELECT
        1 id_config,
        'Taller automotriz' nombre,
        'GTQ' moneda,
        'America/Guatemala' zona_horaria
    FROM dual
) fuente
ON (destino.id_config = fuente.id_config)
WHEN NOT MATCHED THEN
    INSERT (
        id_config,
        nombre,
        moneda,
        zona_horaria,
        creado_en,
        creado_por,
        actualizado_en,
        actualizado_por,
        version_fila
    )
    VALUES (
        fuente.id_config,
        fuente.nombre,
        fuente.moneda,
        fuente.zona_horaria,
        SYSTIMESTAMP,
        NULL,
        SYSTIMESTAMP,
        NULL,
        1
    );
