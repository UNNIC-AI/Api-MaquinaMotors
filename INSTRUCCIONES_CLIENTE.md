# Panel de conversaciones · Cómo usarlo

Con la VPN conectada, el panel está en la dirección donde lo haya instalado vuestro equipo de sistemas. Por defecto es `http://10.210.19.220:3000`. Para entrar, pide la clave de acceso (`API_ACCESS_KEY`).

## El panel

**Conversaciones**

- A la izquierda salen las conversaciones agrupadas por teléfono, de la más reciente a la más antigua, con el último mensaje del cliente.
- **Buscar** encuentra texto en cualquier mensaje ("financiación", "Rebel"…) o un teléfono, con o sin `+34` y con o sin espacios.
- **Desde / Hasta** limita las conversaciones a esas fechas.
- Al abrir una conversación se ven todos los mensajes del cliente y del agente.
- **Resumen IA** resume esa conversación (solo si está configurado OpenAI).

**Resúmenes semanales**

- Elige la semana con las flechas y pulsa **Generar análisis**: un informe de cómo han ido las conversaciones, qué se repite y qué conviene mejorar. Las cifras (conversaciones y mensajes) son exactas, se cuentan sobre toda la semana.
- Los análisis se guardan y se pueden volver a consultar o borrar. Puede haber varios de la misma semana.

**Salir** borra la clave del navegador. También se borra al cerrar la pestaña.

## La API

La misma información está disponible por API para usarla desde otras herramientas. La documentación interactiva está en `/docs`: pulsa **Authorize**, pega la clave y prueba cualquier endpoint con **Try it out**.

Todas las peticiones, salvo `/api/health`, llevan la cabecera `x-api-key`:

```bash
curl -H "x-api-key: TU_CLAVE" "http://10.210.19.220:3000/api/conversaciones?limit=10"
```

| Endpoint | Qué devuelve |
|---|---|
| `GET /api/health` | Estado del servicio y de la conexión con la base de datos. |
| `GET /api/conversaciones` | Conversaciones agrupadas por teléfono. Parámetros opcionales: `limit` (1-200, por defecto 50), `offset`, `from`, `to` (fechas ISO, por ejemplo `2026-10-01T00:00:00Z`) y `q` (texto o teléfono). |
| `GET /api/conversaciones/{telefono}` | Mensajes de un teléfono, por ejemplo `34612345678`. Parámetros opcionales: `from` y `to`. |
| `POST /api/conversaciones/{telefono}/resumen` | Resumen con IA de esa conversación. Opcional en el cuerpo: `from`, `to` y `max_messages` (1-500, por defecto 100). |
| `GET /api/resumenes-semanales` | Análisis semanales guardados. Opcional: `from` y `to` de la semana. |
| `POST /api/resumenes-semanales` | Genera y guarda el análisis de una semana. Cuerpo: `{ "from": "...", "to": "..." }`. |
| `DELETE /api/resumenes-semanales/{id}` | Borra un análisis guardado. |

## Importante

- La clave da acceso a las conversaciones de los clientes: no la compartáis fuera de quien tenga que usar el panel.
- Los resúmenes con IA envían el texto de las conversaciones a OpenAI.
