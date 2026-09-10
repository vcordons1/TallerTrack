ALTER TABLE cliente ADD CONSTRAINT fk_cliente_creado_por
    FOREIGN KEY (creado_por) REFERENCES usuario (id_usuario);
ALTER TABLE cliente ADD CONSTRAINT fk_cliente_actualizado_por
    FOREIGN KEY (actualizado_por) REFERENCES usuario (id_usuario);

ALTER TABLE usuario ADD CONSTRAINT fk_usuario_cliente
    FOREIGN KEY (id_cliente) REFERENCES cliente (id_cliente);
ALTER TABLE usuario ADD CONSTRAINT fk_usuario_creado_por
    FOREIGN KEY (creado_por) REFERENCES usuario (id_usuario);
ALTER TABLE usuario ADD CONSTRAINT fk_usuario_actualizado_por
    FOREIGN KEY (actualizado_por) REFERENCES usuario (id_usuario);

ALTER TABLE usuario_rol ADD CONSTRAINT fk_usuario_rol_usuario
    FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario);
ALTER TABLE usuario_rol ADD CONSTRAINT fk_usuario_rol_rol
    FOREIGN KEY (codigo_rol) REFERENCES rol (codigo_rol);
ALTER TABLE usuario_rol ADD CONSTRAINT fk_usuario_rol_asignador
    FOREIGN KEY (asignado_por) REFERENCES usuario (id_usuario);
ALTER TABLE usuario_rol ADD CONSTRAINT fk_usuario_rol_retirador
    FOREIGN KEY (retirado_por) REFERENCES usuario (id_usuario);

ALTER TABLE sesion ADD CONSTRAINT fk_sesion_usuario
    FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario);

ALTER TABLE token_acceso ADD CONSTRAINT fk_token_cliente
    FOREIGN KEY (id_cliente) REFERENCES cliente (id_cliente);
ALTER TABLE token_acceso ADD CONSTRAINT fk_token_usuario
    FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario);
ALTER TABLE token_acceso ADD CONSTRAINT fk_token_sesion_usuario
    FOREIGN KEY (id_sesion, id_usuario)
    REFERENCES sesion (id_sesion, id_usuario);
ALTER TABLE token_acceso ADD CONSTRAINT fk_token_predecesor
    FOREIGN KEY (id_predecesor) REFERENCES token_acceso (id_token);
ALTER TABLE token_acceso ADD CONSTRAINT fk_token_emisor
    FOREIGN KEY (emitido_por) REFERENCES usuario (id_usuario);

ALTER TABLE comando ADD CONSTRAINT fk_comando_actor
    FOREIGN KEY (id_actor) REFERENCES usuario (id_usuario);
ALTER TABLE comando ADD CONSTRAINT fk_comando_sesion_actor
    FOREIGN KEY (id_sesion, id_actor)
    REFERENCES sesion (id_sesion, id_usuario);

ALTER TABLE auditoria_evento ADD CONSTRAINT fk_auditoria_actor
    FOREIGN KEY (id_actor) REFERENCES usuario (id_usuario);
ALTER TABLE auditoria_evento ADD CONSTRAINT fk_auditoria_sesion_actor
    FOREIGN KEY (id_sesion, id_actor)
    REFERENCES sesion (id_sesion, id_usuario);
ALTER TABLE auditoria_evento ADD CONSTRAINT fk_auditoria_comando
    FOREIGN KEY (id_comando) REFERENCES comando (id_comando);

ALTER TABLE config_taller ADD CONSTRAINT fk_config_creado_por
    FOREIGN KEY (creado_por) REFERENCES usuario (id_usuario);
ALTER TABLE config_taller ADD CONSTRAINT fk_config_actualizado_por
    FOREIGN KEY (actualizado_por) REFERENCES usuario (id_usuario);

CREATE UNIQUE INDEX uq_usuario_rol_vigente ON usuario_rol (
    CASE WHEN retirado_en IS NULL THEN id_usuario END,
    CASE WHEN retirado_en IS NULL THEN codigo_rol END
);

CREATE INDEX ix_cliente_creado_por ON cliente (creado_por);
CREATE INDEX ix_cliente_actualizado_por ON cliente (actualizado_por);
CREATE INDEX ix_usuario_creado_por ON usuario (creado_por);
CREATE INDEX ix_usuario_actualizado_por ON usuario (actualizado_por);
CREATE INDEX ix_usuario_rol_rol ON usuario_rol (codigo_rol);
CREATE INDEX ix_usuario_rol_asignador ON usuario_rol (asignado_por);
CREATE INDEX ix_usuario_rol_retirador ON usuario_rol (retirado_por);
CREATE INDEX ix_sesion_usuario_revocada ON sesion (id_usuario, revocada_en);
CREATE INDEX ix_token_cliente ON token_acceso (id_cliente);
CREATE INDEX ix_token_usuario ON token_acceso (id_usuario);
CREATE INDEX ix_token_sesion_emitido ON token_acceso (id_sesion, emitido_en);
CREATE INDEX ix_token_emisor ON token_acceso (emitido_por);
CREATE UNIQUE INDEX uq_token_renovacion_activa ON token_acceso (
    CASE
        WHEN tipo = 'RENOVACION'
         AND usado_en IS NULL
         AND revocado_en IS NULL
        THEN id_sesion
    END
);
CREATE INDEX ix_comando_actor ON comando (id_actor);
CREATE INDEX ix_comando_sesion ON comando (id_sesion);
CREATE INDEX ix_auditoria_actor ON auditoria_evento (id_actor);
CREATE INDEX ix_auditoria_sesion ON auditoria_evento (id_sesion);
CREATE INDEX ix_auditoria_comando ON auditoria_evento (id_comando);
CREATE INDEX ix_config_creado_por ON config_taller (creado_por);
CREATE INDEX ix_config_actualizado_por ON config_taller (actualizado_por);
