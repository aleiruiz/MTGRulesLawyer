import { reviewErrorCategorySchema } from "@mtg-rules/contracts";
import { z } from "zod";
import { modelRulingSchema } from "./generate.js";
import reviewedEvaluationCases from "./reviewed-evaluation-cases-v1.json" with { type: "json" };

export const rulingEvaluationCaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  question: z.string().min(1),
  cards: z.array(
    z.object({
      name: z.string(),
      oracleText: z.string(),
      quantity: z.number().int().positive().optional(),
    }),
  ),
  rules: z.array(z.object({ number: z.string(), text: z.string() })),
  expectedOutcome: modelRulingSchema.shape.outcome,
  expectedRuleNumbers: z.array(z.string()),
  expectedClarificationCount: z.number().int().nonnegative(),
  errorCategory: reviewErrorCategorySchema.optional(),
  reviewSource: z.enum(["approved_challenge", "maintainer_curated"]).optional(),
  fixtureOrigin: z.enum(["synthetic", "exported"]).optional(),
  modelOutput: z.object({
    outcome: modelRulingSchema.shape.outcome,
    summary: z.string().min(1).max(1_200),
    summarySupport: z.enum(["SUPPORTED", "UNSUPPORTED"]),
    summaryCitationNumbers: z.array(z.string()).max(8),
    reasoningSteps: z
      .array(
        z.object({
          text: z.string().min(1).max(800),
          support: z.enum(["SUPPORTED", "UNSUPPORTED"]),
          citationNumbers: z.array(z.string()).max(8),
        }),
      )
      .max(12),
    assumptions: z.array(z.string().min(1).max(300)).max(12),
    clarificationQuestions: z.array(z.string().min(1).max(300)).max(6),
  }),
});

export type RulingEvaluationCase = z.infer<typeof rulingEvaluationCaseSchema>;

// Citation numbers were checked against Wizards' Comprehensive Rules, June 19, 2026.
const baseEvaluationCases: RulingEvaluationCase[] = [
  {
    id: "layers-timestamp",
    title: "Continuous effects and timestamp order",
    question:
      "Humility and Opalescence affect the same enchantment. What determines the final characteristics?",
    cards: [
      {
        name: "Humility",
        oracleText: "All creatures lose all abilities and have base power and toughness 1/1.",
      },
      {
        name: "Opalescence",
        oracleText:
          "Each other non-Aura enchantment is a creature in addition to its other types and has power and toughness each equal to its mana value.",
      },
    ],
    rules: [
      { number: "613.1", text: "Apply applicable continuous effects in the layer system." },
      {
        number: "613.7",
        text: "Within a layer or sublayer, timestamp order usually determines effect order.",
      },
      {
        number: "613.8",
        text: "Dependency can alter the application order within a layer or sublayer.",
      },
    ],
    expectedOutcome: "conditional",
    expectedRuleNumbers: ["613.1", "613.7", "613.8"],
    expectedClarificationCount: 0,
    modelOutput: {
      outcome: "conditional",
      summary:
        "The final characteristics depend on the applicable layer effects, dependency, and timestamps.",
      summarySupport: "SUPPORTED",
      summaryCitationNumbers: ["613.1"],
      reasoningSteps: [
        {
          text: "Effects are applied in layers, with timestamp order and dependency determining order within a layer.",
          support: "SUPPORTED",
          citationNumbers: ["613.1", "613.7", "613.8"],
        },
      ],
      assumptions: ["Both enchantments are on the battlefield and both effects apply."],
      clarificationQuestions: [],
    },
  },
  {
    id: "replacement-effects-choice",
    title: "Choice among replacement effects",
    question:
      "Two replacement effects would change the same event for my permanent. Who chooses which applies?",
    cards: [
      {
        name: "Rest in Peace",
        oracleText:
          "If a card or token would be put into a graveyard from anywhere, exile it instead.",
      },
      {
        name: "Leyline of the Void",
        oracleText:
          "If a card would be put into an opponent's graveyard from anywhere, exile it instead.",
      },
    ],
    rules: [
      {
        number: "616.1",
        text: "The affected object's controller or owner, or the affected player, chooses among applicable replacement and prevention effects.",
      },
    ],
    expectedOutcome: "resolved",
    expectedRuleNumbers: ["616.1"],
    expectedClarificationCount: 0,
    modelOutput: {
      outcome: "resolved",
      summary:
        "The affected object's controller or owner, or the affected player, chooses the replacement effect to apply.",
      summarySupport: "SUPPORTED",
      summaryCitationNumbers: ["616.1"],
      reasoningSteps: [
        {
          text: "When multiple replacement effects modify the same event, the affected object’s controller or owner, or affected player, chooses one to apply.",
          support: "SUPPORTED",
          citationNumbers: ["616.1"],
        },
      ],
      assumptions: [],
      clarificationQuestions: [],
    },
  },
  {
    id: "attack-trigger-timing",
    title: "Attack trigger timing",
    question:
      "When my Goblin Guide attacks, when does its attack ability trigger and go on the stack?",
    cards: [
      {
        name: "Goblin Guide",
        oracleText:
          "Haste. Whenever Goblin Guide attacks, defending player reveals the top card of their library.",
      },
    ],
    rules: [
      {
        number: "603.2",
        text: "An ability automatically triggers when a game event matches its trigger event.",
      },
      {
        number: "603.3",
        text: "The controller puts a triggered ability on the stack the next time a player would receive priority.",
      },
    ],
    expectedOutcome: "resolved",
    expectedRuleNumbers: ["603.2", "603.3"],
    expectedClarificationCount: 0,
    modelOutput: {
      outcome: "resolved",
      summary:
        "The ability triggers when the attack event occurs and is put on the stack the next time a player would receive priority.",
      summarySupport: "SUPPORTED",
      summaryCitationNumbers: ["603.2", "603.3"],
      reasoningSteps: [
        {
          text: "A matching game event causes the ability to trigger; it is not put on the stack until a player would next receive priority.",
          support: "SUPPORTED",
          citationNumbers: ["603.2", "603.3"],
        },
      ],
      assumptions: [],
      clarificationQuestions: [],
    },
  },
  {
    id: "multiplayer-player-leaves",
    title: "A player leaves a multiplayer game",
    question:
      "In a multiplayer game, what happens to objects a player controls when that player leaves?",
    cards: [{ name: "Mind Control", oracleText: "You control enchanted creature." }],
    rules: [
      {
        number: "800.4a",
        text: "When a player leaves, their owned objects leave, control effects they gave end, and objects still controlled by them are exiled.",
      },
    ],
    expectedOutcome: "resolved",
    expectedRuleNumbers: ["800.4a"],
    expectedClarificationCount: 0,
    modelOutput: {
      outcome: "resolved",
      summary:
        "The result depends on ownership and control: owned objects leave, control effects they gave end, and remaining objects they control are exiled.",
      summarySupport: "SUPPORTED",
      summaryCitationNumbers: ["800.4a"],
      reasoningSteps: [
        {
          text: "The multiplayer rule handles owned objects, control effects, and objects still controlled by the departing player in sequence.",
          support: "SUPPORTED",
          citationNumbers: ["800.4a"],
        },
      ],
      assumptions: ["This is a multiplayer game using the default multiplayer rules."],
      clarificationQuestions: [],
    },
  },
  {
    id: "missing-decisive-fact",
    title: "Missing decisive game fact",
    question: "What happens when my creature dies?",
    cards: [],
    rules: [],
    expectedOutcome: "needs_information",
    expectedRuleNumbers: [],
    expectedClarificationCount: 1,
    modelOutput: {
      outcome: "needs_information",
      summary: "A decisive game fact is missing.",
      summarySupport: "SUPPORTED",
      summaryCitationNumbers: [],
      reasoningSteps: [],
      assumptions: [],
      clarificationQuestions: [
        "Which creature and which relevant ability or replacement effect are involved?",
      ],
    },
  },
];

const reviewedCases: RulingEvaluationCase[] = z
  .array(rulingEvaluationCaseSchema)
  .parse(reviewedEvaluationCases);

export const rulingEvaluationSeedSet: RulingEvaluationCase[] = [
  ...baseEvaluationCases,
  ...reviewedCases,
];
