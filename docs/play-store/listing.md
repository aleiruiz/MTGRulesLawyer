# Google Play listing

Copy these into Play Console under **Grow users → Store presence → Main store listing**. English (United States) is the default language; add **Spanish (Latin America) – es-419** as a translation and paste the Spanish texts there. Spain (`es-ES`) can reuse the same Spanish texts.

Play limits: app name 30 characters, short description 80, full description 4000.

## English (en-US)

**App name** (16)

```
MTG Rules Lawyer
```

**Short description** (72)

```
Ask a Magic rules question and get a ruling backed by the official rules
```

**Full description**

```
Settle rules arguments at the table in seconds.

Describe what happened in your game in plain words. Rules Lawyer finds the cards you mention, reads their Oracle text and official rulings, searches the Comprehensive Rules, and gives you a clear ruling that cites the exact rules it used.

WHAT IT DOES
• Answers the question you actually asked, from the cards and the situation you describe
• Shows each card with its current Oracle text, so everyone at the table sees the same thing
• Cites the Comprehensive Rules and includes the official card rulings in full
• Covers the hard parts: the stack, priority, layers, state-based actions, combat damage, first strike and double strike, deathtouch, trample and loops
• Lets you ask follow-up questions in the same conversation
• Shares a ruling with a link, so your opponent can read it too
• Lets you dispute a ruling you think is wrong; people review disputes to improve the judge
• Works in English and Spanish, and finds cards by their Spanish names

FREE AND OPEN SOURCE
No ads and no analytics. You can ask questions without an account, or sign in with Google or GitHub to keep your conversations. The code is public at github.com/aleiruiz/MTGRulesLawyer.

GOOD TO KNOW
Rules Lawyer is an AI research assistant, not a certified judge. At sanctioned events, the head judge's ruling is final. Rules and card data update daily from official sources.

Rules Lawyer is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. Card images are provided by Scryfall.
```

## Español (es-419)

**Nombre de la app** (16)

```
MTG Rules Lawyer
```

**Descripción breve** (76)

```
Pregunta una regla de Magic y recibe un fallo basado en las reglas oficiales
```

**Descripción completa**

```
Resuelve las discusiones de reglas en la mesa en segundos.

Describe con tus palabras lo que pasó en tu partida. Rules Lawyer encuentra las cartas que mencionas, lee su texto Oracle y sus aclaraciones oficiales, busca en las Reglas Completas y te da un fallo claro que cita las reglas exactas que usó.

QUÉ HACE
• Responde la pregunta que de verdad hiciste, a partir de las cartas y la situación que describes
• Muestra cada carta con su texto Oracle actual, para que toda la mesa vea lo mismo
• Cita las Reglas Completas e incluye completas las aclaraciones oficiales de las cartas
• Cubre lo difícil: la pila, la prioridad, las capas, las acciones basadas en estado, el daño de combate, daña primero y daña dos veces, el toque mortal, arrollar y los bucles
• Te deja hacer preguntas de seguimiento en la misma conversación
• Comparte un fallo con un enlace, para que tu oponente también lo lea
• Te deja disputar un fallo que creas incorrecto; personas revisan las disputas para mejorar al juez
• Funciona en español e inglés, y encuentra las cartas por su nombre en español

GRATIS Y DE CÓDIGO ABIERTO
Sin anuncios ni analíticas. Puedes preguntar sin cuenta, o iniciar sesión con Google o GitHub para guardar tus conversaciones. El código es público en github.com/aleiruiz/MTGRulesLawyer.

BUENO SABER
Rules Lawyer es un asistente de investigación con IA, no un juez certificado. En eventos sancionados, el fallo del juez principal es definitivo. Las reglas y los datos de las cartas se actualizan a diario desde fuentes oficiales.

Rules Lawyer es Contenido de Fans no oficial permitido por la Política de Contenido de Fans. No está aprobado ni respaldado por Wizards. Partes de los materiales usados son propiedad de Wizards of the Coast. ©Wizards of the Coast LLC. Las imágenes de las cartas las proporciona Scryfall.
```

## Store settings

| Field                 | Value                                                              |
| --------------------- | ------------------------------------------------------------------ |
| App or game           | App                                                                |
| Free or paid          | Free (cannot be changed to paid later)                             |
| Category              | Books & Reference                                                  |
| Tags                  | Reference, Board games                                             |
| Contact email         | Your support email (required, shown publicly)                      |
| Website               | `https://mtgruleslawyer.io`                                        |
| Privacy policy        | `https://mtgruleslawyer.io/privacy`                                |
| Ads                   | No, the app contains no ads                                        |
| Account deletion link | `https://mtgruleslawyer.io/sign-in` (sign in, then Delete account) |

## App content answers

These follow the [privacy policy](../../apps/mobile/src/legal/documents.ts). If the app starts storing something new, update both.

**App access:** all functionality is available without special access. Sign-in uses Google or GitHub, which reviewers can use with their own accounts; admin screens are not part of the public app. If Play asks for credentials anyway, choose "All or some functionality is restricted" and explain that any Google account works.

**Content rating (IARC questionnaire):** category "Reference, News, or Educational". Answer No to violence, sexual content, profanity, drugs, gambling and real-money purchases. Users can interact: answer Yes to "shares user-generated content" only if Play counts share links (a ruling link shows the user's question to whoever has the link); otherwise No. Expected rating: Everyone / PEGI 3 or 12 depending on that answer.

**Target audience:** 13 and older (13–15, 16–17, 18+). Not designed for children; the privacy policy says it is not directed at children under 13.

**News app:** No. **COVID-19 tracing:** No. **Government app:** No. **Financial features:** None. **Health:** None.

**Data safety:**

- Does the app collect or share user data? **Yes, collects.** Shared with third parties: **No** (OpenAI, Supabase and Hostinger act as service providers, which Play does not count as sharing).
- Is all data encrypted in transit? **Yes** (HTTPS only).
- Can users request deletion? **Yes** (in the app under Tú/You, and at the account deletion link above).

| Data type                                | Collected | Optional?                       | Purpose                                 |
| ---------------------------------------- | --------- | ------------------------------- | --------------------------------------- |
| Personal info → Email address            | Yes       | Optional (signed-in users only) | Account management                      |
| Personal info → Name                     | Yes       | Optional (signed-in users only) | Account management                      |
| Personal info → User IDs                 | Yes       | Optional (signed-in users only) | Account management, fraud prevention    |
| Messages → Other in-app messages         | Yes       | Required (questions)            | App functionality                       |
| Photos and videos                        | No        |                                 |                                         |
| App activity → Other user-generated text | Yes       | Optional (disputes)             | App functionality                       |
| Device or other IDs                      | No        |                                 |                                         |
| Location                                 | No        | (IP is only kept as a hash)     |                                         |
| App info and performance                 | No        |                                 | No crash reporting or analytics is used |

Questions are "processed ephemerally": **No** (they are stored on the server).

## Graphics checklist

| Asset                     | Spec                                                        | Status                                                                                                                       |
| ------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| App icon                  | 512×512 PNG, up to 1 MB                                     | Ready: [`graphics/icon-512.png`](graphics/icon-512.png)                                                                      |
| Feature graphic           | 1024×500 PNG or JPEG, no transparency                       | Ready: [`graphics/feature-graphic-1024x500.png`](graphics/feature-graphic-1024x500.png)                                      |
| Phone screenshots         | 2–8 images, 9:16 portrait, 1080×1920 or larger, PNG or JPEG | To do: take them on a phone with the internal-testing build (home, card confirmation, a ruling with rules cited, Spanish UI) |
| Spanish phone screenshots | Same, with the phone in Spanish                             | To do: optional, Play falls back to the English ones                                                                         |
| 7" and 10" tablet shots   | Optional; only needed to be featured on tablets             | Skip for now                                                                                                                 |
| Promo video               | Optional YouTube link                                       | Skip for now                                                                                                                 |

Good screenshots to take, in order: the home screen with the "Ask" box, a question with its cards confirmed, a ruling showing the cited rules and official rulings, a follow-up question in the same conversation, and the same ruling in Spanish. Use questions that show off hard rules (for example deathtouch with double strike, or Blood Moon with Urborg).
