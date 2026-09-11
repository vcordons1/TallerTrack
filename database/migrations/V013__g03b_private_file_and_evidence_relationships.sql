ALTER TABLE archivo_privado ADD CONSTRAINT fk_archivo_creador
    FOREIGN KEY (creado_por) REFERENCES usuario (id_usuario);

ALTER TABLE evidencia ADD CONSTRAINT fk_evidencia_orden
    FOREIGN KEY (id_orden) REFERENCES orden_trabajo (id_orden);
ALTER TABLE evidencia ADD CONSTRAINT fk_evidencia_archivo
    FOREIGN KEY (id_archivo) REFERENCES archivo_privado (id_archivo);
ALTER TABLE evidencia ADD CONSTRAINT fk_evidencia_sustituida
    FOREIGN KEY (id_evidencia_sustituida, id_orden, contexto, visibilidad)
    REFERENCES evidencia (id_evidencia, id_orden, contexto, visibilidad);
ALTER TABLE evidencia ADD CONSTRAINT fk_evidencia_registrador
    FOREIGN KEY (registrado_por) REFERENCES usuario (id_usuario);
ALTER TABLE evidencia ADD CONSTRAINT fk_evidencia_comando
    FOREIGN KEY (id_comando) REFERENCES comando (id_comando);

CREATE INDEX ix_archivo_creador ON archivo_privado (creado_por);
CREATE INDEX ix_evidencia_orden_contexto
    ON evidencia (id_orden, contexto, registrado_en, id_evidencia);
CREATE INDEX ix_evidencia_archivo ON evidencia (id_archivo);
CREATE INDEX ix_evidencia_registrador ON evidencia (registrado_por);
CREATE INDEX ix_evidencia_comando ON evidencia (id_comando);

-- Deferred deliberately: DIAGNOSTICO, TRABAJO and PRESUPUESTO belong to I04,
-- and EVALUACION_GARANTIA belongs to I07. Their nullable columns and contextual
-- CHECKs exist now, but their foreign keys and same-order/type checks must be
-- added only by the migrations that create those real parent tables.
COMMENT ON COLUMN evidencia.id_diagnostico IS
    'FK to DIAGNOSTICO deferred until I04';
COMMENT ON COLUMN evidencia.id_trabajo IS
    'FK to TRABAJO deferred until I04';
COMMENT ON COLUMN evidencia.id_presupuesto IS
    'FK to PRESUPUESTO deferred until I04';
COMMENT ON COLUMN evidencia.id_evaluacion IS
    'FK to EVALUACION_GARANTIA deferred until I07';
