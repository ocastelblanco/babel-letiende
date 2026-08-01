# ⚠️ ADVERTENCIA URGENTE — Costos de AWS

**Dirigido a: Claude Code (y cualquier agente IA o desarrollador humano) que vaya a crear o modificar infraestructura AWS en cualquier proyecto de Le Tiende — Babel, Ágora, o los que vengan.**

**Lee este documento COMPLETO antes de escribir la primera línea de `serverless.yml`, de una plantilla de CloudFormation/CDK/Terraform, o de ejecutar el primer `deploy`.** No es teoría: cada punto de aquí salió de una factura real que ya se pagó.

---

## 0. Resumen para el que tiene prisa

En julio de 2026, el proyecto **Babel** facturó **US$94,44** con un objetivo declarado de costo **US$0**. De esos, **US$90,34 (96%) fueron DynamoDB** — capacidad reservada que nunca se usó. La aplicación real (Lambda) costó **US$0,00028** en todo el mes.

El error de fondo no fue técnico. Fue **una suposición sobre precios que nadie verificó** y que quedó escrita como si fuera un hecho, tanto en la especificación como en un comentario del código:

> `# Capacidad aprovisionada 25/25 en todas (capa siempre gratuita de AWS, objetivo de costo $0, nunca on-demand).`

Ese comentario, escrito para **ahorrar** dinero, produjo un cobro de **~US$256/mes**. La corrección tomó un comando.

**Las tres reglas que se derivan:**

1. **Nunca escribas una cifra de precio o un "esto es gratis" que no hayas verificado en la calculadora oficial de AWS ese día.** Si no lo verificaste, escribe "SIN VERIFICAR" al lado.
2. **Configura una alarma de presupuesto ANTES de desplegar la primera pieza de infraestructura.** No después.
3. **Toda capacidad que se cobra por tiempo (por hora/día) y no por uso es un pasivo permanente.** Búscala explícitamente antes de cada `deploy`.

---

## 1. La trampa que costó el dinero: DynamoDB `PROVISIONED`

### Qué se creyó

Que DynamoDB regala **25 RCU + 25 WCU por tabla**, para siempre, y que por lo tanto `PROVISIONED 25/25` era el modo "gratis" y `PAY_PER_REQUEST` (on-demand) era el modo "peligroso que puede generar cargos".

### Qué es cierto

**Los 25 RCU + 25 WCU gratuitos son POR CUENTA DE AWS, no por tabla.** Es el error más caro y más fácil de cometer en DynamoDB.

Babel tenía:

| Concepto | Cantidad |
|---|---|
| Tablas | 8 |
| Stages (`staging` + `production`) | × 2 |
| GSIs (`isbn-index`, que reserva capacidad **propia**) | + 2 |
| **Unidades de capacidad de 25/25** | **18** |
| **Total aprovisionado** | **450 RCU + 450 WCU** |

Eso es **18 veces** el límite gratuito de la cuenta. Y la aritmética del cobro es exacta:

```
Precio us-east-1:  RCU = US$0,00013/hora    WCU = US$0,00065/hora

Una unidad de 25/25:
  25 × 0,00013  +  25 × 0,00065  =  US$0,0195/hora
  × 24 horas                      =  US$0,468/día

18 unidades × US$0,468            =  US$8,424/día     ← cifra exacta facturada
                                                          7 días seguidos
× 30,4 días                       =  US$256/mes
```

El cobro fue **plano, idéntico, siete días seguidos**. Esa es la firma inconfundible de una tarifa por tiempo: no sube con el tráfico ni baja cuando nadie usa la aplicación. **Se cobra 24/7 aunque la aplicación esté apagada.**

El detalle más doloroso: cuando se detectó, las 8 tablas de `production` estaban **completamente vacías** y `staging` tenía **43 registros en total**. Se estaba pagando ~US$256/mes por almacenar 43 items.

### Dos multiplicadores que no se ven

Estos son los que convierten un error pequeño en uno grande. **Cuenta siempre las unidades de capacidad, no las tablas:**

- **Cada stage duplica todo.** `staging` + `production` = 2× la factura. Un tercer stage `dev` la habría llevado a US$384/mes.
- **Cada GSI reserva su propia capacidad, aparte de la tabla.** Un GSI en una tabla `PROVISIONED 25/25` no es gratis: cuesta lo mismo que otra tabla. Con `ProjectionType: ALL`, además duplica el almacenamiento.

### La regla

> ### 🔴 En todos los proyectos de Le Tiende, DynamoDB va SIEMPRE en `BillingMode: PAY_PER_REQUEST`.
>
> No uses `PROVISIONED` nunca, para ningún stage, ni "temporalmente", ni "solo para pruebas".

Para las cargas de Le Tiende (miles de registros, decenas de usuarios internos, un catálogo público de bajo tráfico) el on-demand cuesta **centavos**:

| Operación | Precio us-east-1 | Caso real de Babel | Costo |
|---|---|---|---|
| Escrituras | US$1,25 / millón | Catalogar 3.000 libros (con GSI) ≈ 6.000 | **US$0,008** una sola vez |
| Lecturas | US$0,25 / millón | ~100.000/mes | **US$0,025/mes** |
| Almacenamiento | US$0,25 / GB-mes | 3.000 libros + GSI ≈ 6 MB | **US$0,002/mes** |
| | | **TOTAL** | **< US$0,10/mes** |

El on-demand no era el modo peligroso. **Era el modo correcto desde el principio.** La intuición estaba exactamente al revés: en escalas pequeñas, on-demand es casi gratis y aprovisionado es caro; el aprovisionado solo gana con tráfico alto, constante y predecible, que es justo lo que estos proyectos no tienen.

### Sintaxis correcta

```yaml
TablaLibros:
  Type: AWS::DynamoDB::Table
  Properties:
    TableName: agora-libros-${sls:stage}
    BillingMode: PAY_PER_REQUEST     # ← única línea de capacidad que debe existir
    AttributeDefinitions:
      - AttributeName: bookId
        AttributeType: S
      - AttributeName: isbn
        AttributeType: S
    KeySchema:
      - AttributeName: bookId
        KeyType: HASH
    GlobalSecondaryIndexes:
      - IndexName: isbn-index
        KeySchema:
          - AttributeName: isbn
            KeyType: HASH
        Projection:
          ProjectionType: ALL
        # SIN ProvisionedThroughput: en PAY_PER_REQUEST el GSI hereda el modo
        # de la tabla. Si lo declaras aquí, el despliegue FALLA.
```

**Errores de sintaxis que hay que conocer:**

- Con `PAY_PER_REQUEST`, **NO** puede existir ningún bloque `ProvisionedThroughput` — ni en la tabla ni en los GSIs. CloudFormation falla el despliegue.
- Al revés: con `PROVISIONED`, cada GSI **exige** su propio `ProvisionedThroughput`. Es precisamente lo que hace fácil olvidar que cada GSI se cobra aparte.
- `ProjectionType: ALL` duplica el almacenamiento del item en el índice. Usa `KEYS_ONLY` o `INCLUDE` si no necesitas todos los atributos.

### Si ya desplegaste en `PROVISIONED`: cómo cortar el cobro hoy

El cambio es **in-place, no destructivo: no se pierden datos** y la tabla sigue sirviendo tráfico. Los GSIs se convierten automáticamente con la tabla.

```bash
# Corta el cobro de TODAS las tablas del proyecto de inmediato
for t in $(aws dynamodb list-tables --region us-east-1 \
           --query 'TableNames[?starts_with(@,`agora-`)]' --output text); do
  echo "Convirtiendo $t..."
  aws dynamodb update-table --table-name "$t" \
    --billing-mode PAY_PER_REQUEST --region us-east-1 \
    --query 'TableDescription.TableStatus' --output text
done

# Verifica (debe decir PAY_PER_REQUEST y RCU/WCU en 0 o None)
for t in $(aws dynamodb list-tables --region us-east-1 \
           --query 'TableNames[?starts_with(@,`agora-`)]' --output text); do
  aws dynamodb describe-table --table-name "$t" --region us-east-1 \
    --query "Table.[TableName,TableStatus,BillingModeSummary.BillingMode]" --output text
done
```

⚠️ **Ojo:** AWS permite cambiar el modo de facturación **una vez cada 24 horas por tabla**. Si te equivocas, no puedes deshacerlo de inmediato.

⚠️ **Después de hacerlo por CLI, corrige el IaC en el mismo día.** Si dejas `PROVISIONED` en `serverless.yml`, el siguiente `deploy` **revierte el arreglo** y el cobro vuelve sin que nadie se dé cuenta. El CLI para hoy, el IaC para siempre.

---

## 2. El otro cambio de reglas: la capa gratuita de AWS ya no es la que recuerdas

AWS **reestructuró su modelo de capa gratuita en 2025**. Las cuentas nuevas ya no reciben automáticamente el mismo conjunto de "always free" de servicios que existía antes; el modelo pasó a estar centrado en **créditos de bienvenida que expiran**.

**Consecuencia práctica y no negociable:**

> Nunca escribas "esto está dentro de la capa siempre gratuita" apoyándote en tu conocimiento previo. El conocimiento de los modelos de IA sobre precios de AWS **está desactualizado por definición** y los precios cambian sin avisar.

Antes de afirmar que algo es gratis, **verifícalo el día que lo escribes** en:

- <https://aws.amazon.com/free/> — qué sigue siendo "always free" y qué no
- <https://calculator.aws/> — costo estimado real de la arquitectura completa
- La página de precios del servicio específico (p. ej. <https://aws.amazon.com/dynamodb/pricing/>)

Si no lo verificaste, **escríbelo así**: `<!-- SIN VERIFICAR: confirmar en calculator.aws antes de desplegar -->`. Una suposición marcada como suposición no hace daño. Una suposición escrita como hecho es la que costó US$90.

---

## 3. Catálogo de trampas por servicio

Ordenadas por cuánto duelen. Las tres primeras son las que convierten un proyecto de US$0 en uno de tres cifras.

### 🔴 NAT Gateway — ~US$32/mes, la trampa más cara del serverless

**No aparece en Babel porque Babel no usa VPC. Si Ágora pone una Lambda dentro de una VPC con acceso a internet, aparece.**

Cuesta **~US$0,045/hora (~US$32/mes) por gateway**, más el procesamiento de datos, **y se cobra exista o no tráfico**. Con alta disponibilidad en 2 zonas son ~US$65/mes. Es, por lejos, el mayor destructor de presupuestos serverless.

**Regla:** no metas Lambdas en una VPC a menos que sea estrictamente necesario (p. ej. acceder a un RDS privado). DynamoDB, S3 y las APIs de AWS **no requieren VPC** — se llaman por internet con credenciales IAM. Si la VPC es inevitable, usa **VPC Endpoints** (gateway endpoints de S3/DynamoDB son gratis) en vez de un NAT Gateway.

### 🔴 Cualquier recurso "aprovisionado" o "reservado"

La familia entera comparte la misma trampa: **se cobra por tiempo, no por uso**. Búscalos por nombre antes de cada despliegue:

| Recurso | Costo aproximado | Nota |
|---|---|---|
| DynamoDB `PROVISIONED` | US$0,468/día por 25/25 | **El caso de Babel** |
| Lambda Provisioned Concurrency | ~US$10-15/mes por unidad | Tentador para arreglar cold starts. No lo uses. |
| RDS / Aurora (instancia) | desde ~US$15/mes | Aurora Serverless v2 tiene mínimo de ACUs que también se cobra |
| ElastiCache, OpenSearch, MSK | decenas a cientos/mes | Nunca en un proyecto con objetivo US$0 |
| Elastic IP sin asociar | ~US$3,60/mes | Se cobra precisamente por NO usarla |

**Heurística infalible:** si el precio se expresa **por hora**, es un pasivo permanente. Si se expresa **por millón de solicitudes**, es seguro para estas escalas.

### 🟡 CloudWatch Logs — el goteo que crece solo

La ingesta cuesta **~US$0,50/GB** y, por defecto, **los grupos de logs de Lambda se guardan PARA SIEMPRE**. Una Lambda con logs verbosos en producción genera cargos crecientes e indefinidos.

**Siempre** define retención explícita:

```yaml
provider:
  logRetentionInDays: 14   # nunca dejes el default (infinito)
```

Y no dejes `console.log` de payloads completos en producción.

### 🟡 S3 — artefactos de despliegue que nadie borra

**Encontrado en Babel:** 256 objetos, **6,6 GB** de artefactos de despliegue acumulados. Serverless Framework guarda el paquete de **cada** `deploy` y **jamás los borra por defecto**. El costo de S3 de Babel creció de US$0,0018/día a US$0,044/día en un solo mes — **24× en 30 días**, con tendencia a seguir.

```yaml
provider:
  deploymentBucket:
    maxPreviousDeploymentArtifacts: 5   # conserva 5 para rollback, borra el resto
```

Combínalo con `package: individually: true` sólo si de verdad lo necesitas: multiplica el número de artefactos por función.

### 🟢 Route 53 — costo fijo inevitable, pero contable

**US$0,50 por hosted zone al mes**, se use o no. En la cuenta de Le Tiende hay ~7 zonas = **US$3,58/mes**. Se cobra en bloque el día 1 de cada mes (por eso el CSV de julio muestra US$3,50 el día 01 y centavos el resto de los días).

No es un error ni es atribuible a un proyecto en particular, pero **cuéntalo en el presupuesto**: el "costo $0" de Le Tiende en realidad tiene un piso de ~US$3,58/mes. Y **borra las hosted zones de dominios que ya no uses**.

### 🟢 Los que efectivamente salieron casi gratis en Babel

Para calibrar dónde **no** vale la pena optimizar. Cifras reales de julio de 2026, con la aplicación desplegada y funcionando:

| Servicio | Costo del mes |
|---|---|
| API Gateway (HTTP API) | US$0,096 |
| Lambda | US$0,00028 |
| CloudFront | US$0,00022 |
| ACM (certificados) | US$0 |

**Lección de calibración:** el cómputo, las peticiones y la entrega de contenido de una aplicación como esta son **estadísticamente cero**. Si tu factura no es cero, el culpable casi nunca es el tráfico: **es algo aprovisionado.** No pierdas tiempo optimizando el bundle de Lambda para ahorrar; busca el recurso que se cobra por hora.

---

## 4. Protocolo obligatorio antes de crear infraestructura

### Paso 1 — Alarma de presupuesto ANTES del primer `deploy`

**Esto va primero. Antes de la primera tabla, antes de la primera Lambda.** El sobrecosto de Babel corrió **11 días** sin que nadie lo notara, porque no había nada que avisara. Con una alarma se habría detectado el día 1, con US$8 de pérdida en vez de US$90.

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

cat > /tmp/presupuesto.json <<'EOF'
{
  "BudgetName": "presupuesto-mensual-letiende",
  "BudgetLimit": { "Amount": "10", "Unit": "USD" },
  "TimeUnit": "MONTHLY",
  "BudgetType": "COST"
}
EOF

cat > /tmp/alertas.json <<'EOF'
[{
  "Notification": {
    "NotificationType": "ACTUAL",
    "ComparisonOperator": "GREATER_THAN",
    "Threshold": 50,
    "ThresholdType": "PERCENTAGE"
  },
  "Subscribers": [{
    "SubscriptionType": "EMAIL",
    "Address": "ocastelblanco@gmail.com"
  }]
}]
EOF

aws budgets create-budget --account-id "$ACCOUNT_ID" \
  --budget file:///tmp/presupuesto.json \
  --notifications-with-subscribers file:///tmp/alertas.json
```

Añade umbrales al 50%, 80% y 100%, y uno de tipo `FORECASTED` — este último avisa cuando la **proyección** del mes supera el límite, que es lo que habría cazado el caso de Babel en menos de 24 horas.

### Paso 2 — Auditoría del IaC antes de desplegar

Ejecuta esto sobre la plantilla y **lee la salida**. Si aparece cualquier coincidencia, justifícala explícitamente o elimínala:

```bash
grep -nE "PROVISIONED|ProvisionedThroughput|CapacityUnits|ProvisionedConcurrency|NatGateway|AWS::RDS|AWS::ElastiCache|AWS::OpenSearch" serverless.yml
```

### Paso 3 — Verificación DESPUÉS del primer despliegue

No confíes en que el IaC hizo lo que creías. **Mira la cuenta real:**

```bash
# ¿Alguna tabla quedó aprovisionada?
aws dynamodb list-tables --region us-east-1 --query 'TableNames[]' --output text | tr '\t' '\n' | \
while read t; do
  aws dynamodb describe-table --table-name "$t" --region us-east-1 \
    --query "Table.[TableName,BillingModeSummary.BillingMode]" --output text
done

# ¿Algún NAT Gateway vivo?
aws ec2 describe-nat-gateways --filter Name=state,Values=available \
  --query 'NatGateways[].NatGatewayId' --output text

# ¿Alguna IP elástica sin asociar? (se cobra por estar ociosa)
aws ec2 describe-addresses --query 'Addresses[?AssociationId==`null`].PublicIp' --output text
```

### Paso 4 — Revisión de costos a las 48 horas

**El paso que faltó en Babel.** Un despliegue puede verse perfecto y estar sangrando. Dos días después del primer `deploy`, mira el costo diario real:

```bash
aws ce get-cost-and-usage \
  --time-period Start=$(date -v-7d +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity DAILY --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --query 'ResultsByTime[].{Fecha:TimePeriod.Start,Servicios:Groups[?Metrics.UnblendedCost.Amount!=`0`].[Keys[0],Metrics.UnblendedCost.Amount]}'
```

**Cómo leer el resultado — esta es la parte importante:**

- Un costo diario **plano e idéntico** día tras día = **capacidad aprovisionada**. 🚨 Investiga de inmediato.
- Un costo que **sube y baja con el uso** = correcto, así se comporta el serverless.
- Un costo que **crece monótonamente** = almacenamiento acumulándose (S3, CloudWatch Logs).

---

## 5. Checklist antes del primer `deploy` de Ágora

Copia esta lista al PR que cree la infraestructura y márcala de verdad.

- [ ] Alarma de presupuesto creada **y probada** (llegó el correo), con umbral `FORECASTED`
- [ ] Todas las tablas DynamoDB en `BillingMode: PAY_PER_REQUEST`
- [ ] Ningún bloque `ProvisionedThroughput` en la plantilla — ni en tablas ni en GSIs
- [ ] Contadas las **unidades de capacidad** (tablas × stages + GSIs), no solo las tablas
- [ ] Ningún NAT Gateway; ninguna Lambda en VPC sin justificación escrita
- [ ] `logRetentionInDays` definido (nunca el default infinito)
- [ ] `maxPreviousDeploymentArtifacts` definido
- [ ] Ninguna afirmación de "es gratis" en la documentación sin verificar ese día en `calculator.aws`
- [ ] Estimación de costo mensual escrita en el PR, con el enlace a la fuente de cada precio
- [ ] Recordatorio agendado para revisar el costo diario **48 horas después** del despliegue

---

## 6. La lección de fondo

El error no fue elegir mal entre dos modos de facturación. Fue **escribir una suposición sobre precios con la misma autoridad que un hecho verificado**, y luego blindarla con un comentario en el código (`nunca on-demand`) que impedía que alguien la cuestionara después.

Ese comentario hizo dos cosas a la vez: consagró el error y **prohibió la solución correcta**. Cualquiera que después hubiera pensado "¿y si usamos on-demand?" habría leído "nunca on-demand" y seguido de largo.

Para un agente IA hay un riesgo específico y agravado: **el conocimiento sobre precios de nube está desactualizado por construcción** — el modelo se entrenó con datos de hace meses o años, y AWS cambia precios y estructuras de capa gratuita sin previo aviso. La confianza con la que un modelo puede afirmar "25 RCU son gratis" **no guarda ninguna relación** con que eso siga siendo cierto hoy, en esta cuenta, bajo este modelo de capa gratuita.

**Por eso:** los precios se verifican, no se recuerdan. Y lo que no se verificó se marca como no verificado.

---

## 7. Cronología del caso (referencia)

| Fecha | Hecho |
|---|---|
| ~19/07/2026 | Primer despliegue con tablas DynamoDB `PROVISIONED 25/25` |
| 20/07/2026 | Primer cobro: US$6,16 (12 unidades) |
| 21–24/07/2026 | El cobro escala con cada despliegue: US$5,62 → US$6,55 → US$7,16 |
| 25/07/2026 | Se estabiliza en **US$8,424/día** (18 unidades). 450 RCU + 450 WCU |
| 25–31/07/2026 | Siete días de cobro plano e idéntico. **Nadie lo detecta: no había alarma** |
| 31/07/2026 | Cierre de julio: **US$90,34** de DynamoDB sobre US$94,44 totales |
| 01/08/2026 | AWS notifica el sobrecosto. Diagnóstico, conversión a `PAY_PER_REQUEST` de las 16 tablas y corrección del IaC **el mismo día** |

**Costo total del error: ~US$90 y 11 días.** Costo de la corrección: un comando y quince minutos.

**Costo de no haber verificado una línea de la especificación: los mismos US$90.**
