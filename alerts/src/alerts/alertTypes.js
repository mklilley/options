const { z } = require("zod");

const ConditionKindSchema = z.enum([
  "percent_change_from_entry",
  "absolute_change_from_entry",
  "target_price"
]);

const DirectionSchema = z.enum(["above", "below"]);
const ContractTypeSchema = z.enum(["call", "put"]);
const PriceBasisSchema = z.enum(["last_trade", "last_trade_with_mid_fallback"]);
const PriceSourceSchema = z.enum(["last_trade", "mid_bid_ask", "unavailable"]);
const TriggerStateSchema = z.enum(["armed", "triggered"]);

const IsoDateTimeSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Must be an ISO-like date time string"
});

const AlertConditionSchema = z.object({
  kind: ConditionKindSchema,
  direction: DirectionSchema,
  threshold: z.number().positive()
}).strict();

const AlertSchema = z.object({
  id: z.string().uuid(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  active: z.boolean(),
  telegramUserId: z.string().regex(/^\d+$/).nullable().default(null),
  chatId: z.string().regex(/^-?\d+$/).nullable().default(null),
  underlyingSymbol: z.string().min(1),
  underlyingName: z.string().min(1),
  contractType: ContractTypeSchema,
  expirationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  strikePrice: z.number().positive(),
  optionContract: z.string().min(1),
  entryPrice: z.number().positive(),
  priceBasis: PriceBasisSchema,
  condition: AlertConditionSchema,
  lastObservedPrice: z.number().nullable(),
  lastObservedAt: IsoDateTimeSchema.nullable(),
  lastObservedPriceSource: PriceSourceSchema.nullable(),
  lastObservedChangePercent: z.number().nullable(),
  lastTriggeredAt: IsoDateTimeSchema.nullable(),
  triggerState: TriggerStateSchema
}).strict();

const AlertsFileSchema = z.object({
  alerts: z.array(AlertSchema)
}).strict();

const DEFAULT_ALERTS_FILE = {
  alerts: []
};

module.exports = {
  AlertSchema,
  AlertsFileSchema,
  DEFAULT_ALERTS_FILE,
  ConditionKindSchema,
  DirectionSchema,
  ContractTypeSchema,
  PriceSourceSchema,
  TriggerStateSchema
};
