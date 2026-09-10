DECLARE
    l_current_schema VARCHAR2(128);
BEGIN
    l_current_schema := SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA');

    IF l_current_schema <> USER THEN
        RAISE_APPLICATION_ERROR(
            -20001,
            'The migration connection must use its own schema as CURRENT_SCHEMA.'
        );
    END IF;
END;
/
