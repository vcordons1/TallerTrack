ALTER TABLE vehiculo ADD CONSTRAINT fk_vehiculo_tipo
    FOREIGN KEY (codigo_tipo) REFERENCES tipo_vehiculo (codigo_tipo);
ALTER TABLE vehiculo ADD CONSTRAINT fk_vehiculo_creado_por
    FOREIGN KEY (creado_por) REFERENCES usuario (id_usuario);
ALTER TABLE vehiculo ADD CONSTRAINT fk_vehiculo_actualizado_por
    FOREIGN KEY (actualizado_por) REFERENCES usuario (id_usuario);

ALTER TABLE propiedad_vehiculo ADD CONSTRAINT fk_propiedad_vehiculo
    FOREIGN KEY (id_vehiculo) REFERENCES vehiculo (id_vehiculo);
ALTER TABLE propiedad_vehiculo ADD CONSTRAINT fk_propiedad_cliente
    FOREIGN KEY (id_cliente) REFERENCES cliente (id_cliente);
ALTER TABLE propiedad_vehiculo ADD CONSTRAINT fk_propiedad_registrador
    FOREIGN KEY (registrado_por) REFERENCES usuario (id_usuario);
ALTER TABLE propiedad_vehiculo ADD CONSTRAINT fk_propiedad_cerrador
    FOREIGN KEY (cerrado_por) REFERENCES usuario (id_usuario);
ALTER TABLE propiedad_vehiculo ADD CONSTRAINT fk_propiedad_predecesora
    FOREIGN KEY (id_predecesora, id_vehiculo)
    REFERENCES propiedad_vehiculo (id_propiedad, id_vehiculo);
ALTER TABLE propiedad_vehiculo ADD CONSTRAINT fk_propiedad_comando
    FOREIGN KEY (id_comando) REFERENCES comando (id_comando);

ALTER TABLE qr_token ADD CONSTRAINT fk_qr_vehiculo
    FOREIGN KEY (id_vehiculo) REFERENCES vehiculo (id_vehiculo);
ALTER TABLE qr_token ADD CONSTRAINT fk_qr_emisor
    FOREIGN KEY (emitido_por) REFERENCES usuario (id_usuario);
ALTER TABLE qr_token ADD CONSTRAINT fk_qr_revocador
    FOREIGN KEY (revocado_por) REFERENCES usuario (id_usuario);
ALTER TABLE qr_token ADD CONSTRAINT fk_qr_comando
    FOREIGN KEY (id_comando) REFERENCES comando (id_comando);

CREATE UNIQUE INDEX uq_propiedad_actual ON propiedad_vehiculo (
    CASE WHEN hasta_en IS NULL THEN id_vehiculo END
);

CREATE UNIQUE INDEX uq_qr_no_revocado ON qr_token (
    CASE WHEN revocado_en IS NULL THEN id_vehiculo END
);

CREATE INDEX ix_vehiculo_tipo ON vehiculo (codigo_tipo);
CREATE INDEX ix_vehiculo_creado_por ON vehiculo (creado_por);
CREATE INDEX ix_vehiculo_actualizado_por ON vehiculo (actualizado_por);
CREATE INDEX ix_prop_vehiculo_desde ON propiedad_vehiculo (id_vehiculo, desde_en, id_propiedad);
CREATE INDEX ix_prop_cliente_hasta ON propiedad_vehiculo (id_cliente, hasta_en, id_propiedad);
CREATE INDEX ix_prop_registrador ON propiedad_vehiculo (registrado_por);
CREATE INDEX ix_prop_cerrador ON propiedad_vehiculo (cerrado_por);
CREATE INDEX ix_prop_comando ON propiedad_vehiculo (id_comando);
CREATE INDEX ix_qr_vehiculo_emitido ON qr_token (id_vehiculo, emitido_en, id_qr);
CREATE INDEX ix_qr_emisor ON qr_token (emitido_por);
CREATE INDEX ix_qr_revocador ON qr_token (revocado_por);
CREATE INDEX ix_qr_comando ON qr_token (id_comando);

CREATE VIEW v_propietario_actual AS
SELECT
    id_propiedad,
    id_vehiculo,
    id_cliente,
    desde_en,
    motivo
FROM propiedad_vehiculo
WHERE hasta_en IS NULL;
