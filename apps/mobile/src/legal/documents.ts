import type { Language } from "../i18n/core";

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDocument {
  title: string;
  updated: string;
  sections: LegalSection[];
}

const CONTACT = "https://github.com/aleiruiz/MTGRulesLawyer/issues";

// Keep these in step with what the app actually stores (docs/operations.md) and with each other.
const privacy: Record<Language, LegalDocument> = {
  en: {
    title: "Privacy policy",
    updated: "Last updated October 13, 2026",
    sections: [
      {
        heading: "Who we are",
        paragraphs: [
          "Rules Lawyer is a free, open-source fan project run by one maintainer. It has no ads, no analytics and does not sell or share your data for marketing.",
          `For questions or requests about your data, open an issue at ${CONTACT}.`,
        ],
      },
      {
        heading: "What we store",
        paragraphs: [
          "Questions and rulings: the question you ask, the cards you confirm and the ruling the judge gives are stored on our server, whether or not you are signed in. A ruling's share link lets anyone who has it read that question and ruling.",
          "Account: you sign in with Google or GitHub through Supabase, which keeps the email address, name and profile picture that provider shares. Our own database stores only your Supabase user ID, your role, your saved conversations and your disputes.",
          "Disputes: the explanation you write when you dispute a ruling. If you give consent, a de-identified version of the scenario (without your question, explanation or account) may be added to the judge's public test cases.",
          "Abuse limits: to count daily questions we store a keyed hash of your IP address and account, never the address itself, and delete it the next day. Server logs record IP addresses and request paths to keep the service running.",
          "On your device: your language choice and your sign-in session.",
        ],
      },
      {
        heading: "Services that process your data",
        paragraphs: [
          "OpenAI receives your question with the relevant rules and card text to interpret it and write the ruling; for hard questions it may also run a web search.",
          "Supabase handles sign-in. Hostinger hosts our server and database.",
          "Card images load directly from Scryfall, so your browser or phone contacts Scryfall's servers.",
        ],
      },
      {
        heading: "Deleting your data",
        paragraphs: [
          "You can delete your account at any time from the You screen. Deletion is immediate: your account, saved conversations and unreviewed disputes are removed, and your Supabase sign-in is deleted. Your past questions stay only as anonymous rulings so shared links keep working, and disputes a judge already reviewed stay without any link to you.",
          "We keep no backups, so deleted data cannot be restored.",
        ],
      },
      {
        heading: "Children",
        paragraphs: ["Rules Lawyer is not directed at children under 13."],
      },
      {
        heading: "Changes",
        paragraphs: ["If this policy changes, we update this page and its date."],
      },
    ],
  },
  es: {
    title: "Aviso de privacidad",
    updated: "Última actualización: 13 de octubre de 2026",
    sections: [
      {
        heading: "Quiénes somos",
        paragraphs: [
          "Rules Lawyer es un proyecto de fans gratuito y de código abierto, mantenido por una sola persona. No tiene anuncios ni analíticas, y no vende ni comparte tus datos con fines de mercadotecnia.",
          `Para preguntas o solicitudes sobre tus datos, abre un issue en ${CONTACT}.`,
        ],
      },
      {
        heading: "Qué guardamos",
        paragraphs: [
          "Preguntas y fallos: la pregunta que haces, las cartas que confirmas y el fallo del juez se guardan en nuestro servidor, hayas iniciado sesión o no. Cualquiera que tenga el enlace para compartir un fallo puede leer esa pregunta y ese fallo.",
          "Cuenta: inicias sesión con Google o GitHub a través de Supabase, que guarda el correo, el nombre y la foto de perfil que ese proveedor comparte. Nuestra base de datos solo guarda tu ID de usuario de Supabase, tu rol, tus conversaciones guardadas y tus disputas.",
          "Disputas: la explicación que escribes al disputar un fallo. Si das tu consentimiento, una versión sin datos personales del escenario (sin tu pregunta, tu explicación ni tu cuenta) puede agregarse a los casos de prueba públicos del juez.",
          "Límites contra abuso: para contar las preguntas diarias guardamos un hash con clave de tu dirección IP y de tu cuenta, nunca la dirección en sí, y lo borramos al día siguiente. Los registros del servidor guardan direcciones IP y rutas de las solicitudes para mantener el servicio funcionando.",
          "En tu dispositivo: tu idioma y tu sesión.",
        ],
      },
      {
        heading: "Servicios que procesan tus datos",
        paragraphs: [
          "OpenAI recibe tu pregunta junto con las reglas y el texto de las cartas relevantes para interpretarla y escribir el fallo; en preguntas difíciles también puede hacer una búsqueda web.",
          "Supabase se encarga del inicio de sesión. Hostinger aloja nuestro servidor y la base de datos.",
          "Las imágenes de las cartas se cargan directamente de Scryfall, así que tu navegador o teléfono se conecta a los servidores de Scryfall.",
        ],
      },
      {
        heading: "Borrar tus datos",
        paragraphs: [
          "Puedes borrar tu cuenta cuando quieras desde la pantalla Tú. El borrado es inmediato: se eliminan tu cuenta, tus conversaciones guardadas y tus disputas sin revisar, y se borra tu inicio de sesión en Supabase. Tus preguntas anteriores quedan solo como fallos anónimos para que los enlaces compartidos sigan funcionando, y las disputas que un juez ya revisó se conservan sin ningún vínculo contigo.",
          "No guardamos respaldos, así que los datos borrados no se pueden recuperar.",
        ],
      },
      {
        heading: "Menores",
        paragraphs: ["Rules Lawyer no está dirigido a menores de 13 años."],
      },
      {
        heading: "Cambios",
        paragraphs: ["Si este aviso cambia, actualizamos esta página y su fecha."],
      },
    ],
  },
};

const terms: Record<Language, LegalDocument> = {
  en: {
    title: "Terms of use",
    updated: "Last updated October 13, 2026",
    sections: [
      {
        heading: "The service",
        paragraphs: [
          "Rules Lawyer is a free fan project that answers Magic: The Gathering rules questions with an AI judge. It is provided as is, without warranties, and may change, limit or stop at any time.",
        ],
      },
      {
        heading: "Rulings can be wrong",
        paragraphs: [
          "Rulings are generated by AI from the Comprehensive Rules, Oracle text and official rulings, and can be wrong or incomplete. They are not official judge rulings. At a sanctioned event, the event's judges have the final word.",
          "If a ruling looks wrong, dispute it so a person can review it.",
        ],
      },
      {
        heading: "Fair use",
        paragraphs: [
          "Use Rules Lawyer for rules questions. Do not try to get around the daily limits, automate requests, attack or overload the service, or submit illegal content or other people's personal information.",
          "We may limit or remove accounts that break these rules.",
        ],
      },
      {
        heading: "Your content",
        paragraphs: [
          "You keep what you write. By submitting a question or dispute, you let us store it, send it to the services described in the privacy policy to answer it, and show it to anyone who has its share link.",
        ],
      },
      {
        heading: "Your account",
        paragraphs: ["An account is optional. You can delete it at any time from the You screen."],
      },
      {
        heading: "Wizards of the Coast",
        paragraphs: [
          "Rules Lawyer is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.",
          "Card data and images are provided by Scryfall.",
        ],
      },
      {
        heading: "Contact",
        paragraphs: [`Open an issue at ${CONTACT}.`],
      },
    ],
  },
  es: {
    title: "Términos de uso",
    updated: "Última actualización: 13 de octubre de 2026",
    sections: [
      {
        heading: "El servicio",
        paragraphs: [
          "Rules Lawyer es un proyecto de fans gratuito que responde preguntas de reglas de Magic: The Gathering con un juez de IA. Se ofrece tal cual, sin garantías, y puede cambiar, limitarse o terminar en cualquier momento.",
        ],
      },
      {
        heading: "Los fallos pueden equivocarse",
        paragraphs: [
          "Los fallos los genera una IA a partir de las Reglas Completas, el texto de Oracle y las aclaraciones oficiales, y pueden estar mal o incompletos. No son fallos oficiales de un juez. En un evento sancionado, los jueces del evento tienen la última palabra.",
          "Si un fallo parece incorrecto, dispútalo para que lo revise una persona.",
        ],
      },
      {
        heading: "Uso justo",
        paragraphs: [
          "Usa Rules Lawyer para preguntas de reglas. No intentes saltarte los límites diarios, automatizar solicitudes, atacar o saturar el servicio, ni enviar contenido ilegal o datos personales de otras personas.",
          "Podemos limitar o eliminar cuentas que no respeten estas reglas.",
        ],
      },
      {
        heading: "Tu contenido",
        paragraphs: [
          "Lo que escribes sigue siendo tuyo. Al enviar una pregunta o disputa, nos permites guardarla, enviarla a los servicios descritos en el aviso de privacidad para responderla y mostrarla a quien tenga su enlace para compartir.",
        ],
      },
      {
        heading: "Tu cuenta",
        paragraphs: ["La cuenta es opcional. Puedes borrarla cuando quieras desde la pantalla Tú."],
      },
      {
        heading: "Wizards of the Coast",
        paragraphs: [
          "Rules Lawyer es Fan Content no oficial permitido bajo la Fan Content Policy. No está aprobado ni respaldado por Wizards. Partes de los materiales usados son propiedad de Wizards of the Coast. ©Wizards of the Coast LLC.",
          "Los datos e imágenes de las cartas los proporciona Scryfall.",
        ],
      },
      {
        heading: "Contacto",
        paragraphs: [`Abre un issue en ${CONTACT}.`],
      },
    ],
  },
};

export const legalDocuments = { privacy, terms };
export type LegalDocumentKind = keyof typeof legalDocuments;
