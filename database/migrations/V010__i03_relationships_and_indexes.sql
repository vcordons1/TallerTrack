ALTER TABLE cita ADD CONSTRAINT fk_cita_vehiculo
    FOREIGN KEY (id_vehiculo) REFERENCES vehiculo (id_vehiculo);
ALTER TABLE cita ADD CONSTRAINT fk_cita_usuario
    FOREIGN KEY (id_usuario_solicita) REFERENCES usuario (id_usuario);
ALTER TABLE cita ADD CONSTRAINT fk_cita_qr_vehiculo
    FOREIGN KEY (id_qr_origen, id_vehiculo)
    REFERENCES qr_token (id_qr, id_vehiculo);

ALTER TABLE cita_evento ADD CONSTRAINT fk_cita_evento_cita
    FOREIGN KEY (id_cita) REFERENCES cita (id_cita);
ALTER TABLE cita_evento ADD CONSTRAINT fk_cita_evento_actor
    FOREIGN KEY (registrado_por) REFERENCES usuario (id_usuario);
ALTER TABLE cita_evento ADD CONSTRAINT fk_cita_evento_comando
    FOREIGN KEY (id_comando) REFERENCES comando (id_comando);

ALTER TABLE orden_trabajo ADD CONSTRAINT fk_orden_vehiculo
    FOREIGN KEY (id_vehiculo) REFERENCES vehiculo (id_vehiculo);
ALTER TABLE orden_trabajo ADD CONSTRAINT fk_orden_cliente
    FOREIGN KEY (id_cliente) REFERENCES cliente (id_cliente);
ALTER TABLE orden_trabajo ADD CONSTRAINT fk_orden_propiedad
    FOREIGN KEY (id_propiedad_apertura, id_vehiculo, id_cliente)
    REFERENCES propiedad_vehiculo (id_propiedad, id_vehiculo, id_cliente);
ALTER TABLE orden_trabajo ADD CONSTRAINT fk_orden_cita_vehiculo
    FOREIGN KEY (id_cita, id_vehiculo)
    REFERENCES cita (id_cita, id_vehiculo);
ALTER TABLE orden_trabajo ADD CONSTRAINT fk_orden_entregador
    FOREIGN KEY (entregado_por) REFERENCES usuario (id_usuario);
ALTER TABLE orden_trabajo ADD CONSTRAINT fk_orden_creador
    FOREIGN KEY (creado_por) REFERENCES usuario (id_usuario);
ALTER TABLE orden_trabajo ADD CONSTRAINT fk_orden_comando
    FOREIGN KEY (id_comando) REFERENCES comando (id_comando);

ALTER TABLE orden_evento ADD CONSTRAINT fk_orden_evento_orden
    FOREIGN KEY (id_orden) REFERENCES orden_trabajo (id_orden);
ALTER TABLE orden_evento ADD CONSTRAINT fk_orden_evento_actor
    FOREIGN KEY (registrado_por) REFERENCES usuario (id_usuario);
ALTER TABLE orden_evento ADD CONSTRAINT fk_orden_evento_comando
    FOREIGN KEY (id_comando) REFERENCES comando (id_comando);

ALTER TABLE orden_mecanico ADD CONSTRAINT fk_orden_mecanico_orden
    FOREIGN KEY (id_orden) REFERENCES orden_trabajo (id_orden);
ALTER TABLE orden_mecanico ADD CONSTRAINT fk_orden_mecanico_usuario
    FOREIGN KEY (id_mecanico) REFERENCES usuario (id_usuario);
ALTER TABLE orden_mecanico ADD CONSTRAINT fk_orden_mecanico_asignador
    FOREIGN KEY (asignado_por) REFERENCES usuario (id_usuario);
ALTER TABLE orden_mecanico ADD CONSTRAINT fk_orden_mecanico_retirador
    FOREIGN KEY (retirado_por) REFERENCES usuario (id_usuario);

CREATE UNIQUE INDEX uq_orden_activa_vehiculo ON orden_trabajo (
    CASE WHEN estado IN (
        'RECIBIDO', 'EN_DIAGNOSTICO', 'ESPERANDO_AUTORIZACION',
        'EN_REPARACION', 'LISTO_PARA_ENTREGA',
        'PENDIENTE_ENTREGA_SIN_REPARACION'
    ) THEN id_vehiculo END
);

CREATE UNIQUE INDEX uq_orden_mecanico_abierto ON orden_mecanico (
    CASE WHEN retirado_en IS NULL THEN id_orden END,
    CASE WHEN retirado_en IS NULL THEN id_mecanico END
);

CREATE INDEX ix_cita_estado_inicio ON cita (estado, inicio_programado, id_cita);
CREATE INDEX ix_cita_vehiculo_estado ON cita (id_vehiculo, estado);
CREATE INDEX ix_cita_usuario ON cita (id_usuario_solicita);
CREATE INDEX ix_cita_qr ON cita (id_qr_origen);
CREATE INDEX ix_cita_evento_historia ON cita_evento (id_cita, registrado_en, id_evento_cita);
CREATE INDEX ix_cita_evento_actor ON cita_evento (registrado_por);
CREATE INDEX ix_cita_evento_comando ON cita_evento (id_comando);
CREATE INDEX ix_orden_cliente_entrega ON orden_trabajo (id_cliente, entregado_en, id_orden);
CREATE INDEX ix_orden_vehiculo_ingreso ON orden_trabajo (id_vehiculo, ingresado_en, id_orden);
CREATE INDEX ix_orden_estado_ingreso ON orden_trabajo (estado, ingresado_en, id_orden);
CREATE INDEX ix_orden_propiedad ON orden_trabajo (id_propiedad_apertura);
CREATE INDEX ix_orden_creador ON orden_trabajo (creado_por);
CREATE INDEX ix_orden_entregador ON orden_trabajo (entregado_por);
CREATE INDEX ix_orden_comando ON orden_trabajo (id_comando);
CREATE INDEX ix_orden_evento_historia ON orden_evento (id_orden, registrado_en, id_evento_orden);
CREATE INDEX ix_orden_evento_actor ON orden_evento (registrado_por);
CREATE INDEX ix_orden_evento_comando ON orden_evento (id_comando);
CREATE INDEX ix_orden_mecanico_actual ON orden_mecanico (id_mecanico, retirado_en, id_orden);
CREATE INDEX ix_orden_mecanico_asignador ON orden_mecanico (asignado_por);
CREATE INDEX ix_orden_mecanico_retirador ON orden_mecanico (retirado_por);
