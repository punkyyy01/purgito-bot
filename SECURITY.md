# Política de seguridad

## Versiones soportadas

Solo la rama `main` recibe parches de seguridad.

## Reportar una vulnerabilidad

**No abras un issue público** si encontraste una vulnerabilidad de seguridad.

Contactá directamente por Discord al administrador del servidor PURG4TORY, describiendo:

- Descripción del problema
- Pasos para reproducirlo
- Impacto potencial
- (Opcional) Sugerencia de fix

Respondemos en menos de 72 horas. Una vez confirmada y corregida la vulnerabilidad, la divulgaremos en el CHANGELOG.

## Datos sensibles

Este bot no almacena contraseñas ni datos personales de usuarios. Almacena:
- Contenido de mensajes para el corpus de cadenas de Markov (texto plano en SQLite)
- URLs de GIFs agregados por miembros del servidor
- IDs de usuario de Discord asociados a GIFs

No compartas tu `DISCORD_TOKEN`, `CF_R2_*`, ni ninguna otra variable de entorno.
