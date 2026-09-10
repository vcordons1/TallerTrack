MERGE INTO tipo_vehiculo destino
USING (
    SELECT 'AUTOMOVIL' codigo_tipo, 'Automovil' nombre FROM dual
    UNION ALL SELECT 'MOTOCICLETA', 'Motocicleta' FROM dual
    UNION ALL SELECT 'CAMIONETA', 'Camioneta' FROM dual
    UNION ALL SELECT 'CAMION', 'Camion' FROM dual
    UNION ALL SELECT 'OTRO', 'Otro' FROM dual
) fuente
ON (destino.codigo_tipo = fuente.codigo_tipo)
WHEN NOT MATCHED THEN
    INSERT (codigo_tipo, nombre, activo)
    VALUES (fuente.codigo_tipo, fuente.nombre, 1);
