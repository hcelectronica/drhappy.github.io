# Solicitud de receta I.O.M.A.: integración frontend

La ruta pública es `/?ioma=<alias>` (en instalaciones con base distinta de `/`, se usa esa base). La recepción muestra **RECETA I.O.M.A** cuando su respuesta pública incluye `reception.iomaUrl`. Esta opción es independiente de los documentos pagos y no inicia ningún cobro. En Mi recepción hay una configuración y bandeja separadas; la receta se gestiona fuera de esta función.

El cliente invoca la Edge Function `ioma-prescriptions`, con `action` en el cuerpo. `public-info` y `submit` son públicos; las demás acciones requieren una sesión profesional válida, propia o de Supabase. Si existe una sesión propia, envía `x-drhappy-session`. La respuesta incluye `success` y puede incluir `message`:

| Acción | Entrada adicional | Respuesta adicional |
| --- | --- | --- |
| `public-info` | `slug` | `professionalName`, `enabled` |
| `submit` | `slug`, `patientFirstName`, `patientLastName`, `patientDni`, `patientEmail`, `patientPhone`, `birthDate`, `insuranceMemberNumber`, `medication`, `consent`, `website` | `emailSent` |
| `get-settings` | — | `enabled`, `slug` |
| `save-settings` | `enabled` | `enabled`, `slug` |
| `list` | `offset` | `requests`, hasta 100 por página |
| `complete` | `id` | `success` |

Cada elemento de `requests` contiene `id`, `patient_first_name`, `patient_last_name`, `patient_dni`, `patient_email`, `patient_phone`, `patient_birth_date`, `insurance_member_number`, `medication`, `status`, `email_status` y `created_at`. La bandeja acumula páginas hasta que la página recibida contiene menos de 100 registros; Actualizar vuelve a la primera. Se requiere orden estable en el servidor.

La solicitud no recibe capturas ni tokens y no emite la receta. Si no se confirma la respuesta al enviar, el paciente debe consultar al consultorio antes de reintentar para evitar duplicados; la falla del aviso por correo no equivale a una solicitud rechazada.
