/**
 * Deterministic finance calculators. The LLM must never do this arithmetic itself.
 * src/server/tools/calcTools.ts
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const sipSchema = z.object({
  monthly: z.number().describe("Monthly contribution."),
  annualRatePct: z.number().describe("Expected annual return, e.g. 12 for 12%."),
  years: z.number().int().describe("Investment horizon in years."),
});

export const sipFutureValue = tool(
  ({ monthly, annualRatePct, years }: z.infer<typeof sipSchema>): string => {
    const rate = annualRatePct / 100 / 12;
    const months = years * 12;
    const value = rate
      ? monthly * (((1 + rate) ** months - 1) / rate) * (1 + rate)
      : monthly * months;
    return String(Math.round(value * 100) / 100);
  },
  {
    name: "sip_future_value",
    description: "Future value of a monthly SIP. Always use this instead of mental math.",
    schema: sipSchema,
  }
);

const cagrSchema = z.object({
  startValue: z.number(),
  endValue: z.number(),
  years: z.number(),
});

export const cagr = tool(
  ({ startValue, endValue, years }: z.infer<typeof cagrSchema>): string => {
    if (startValue <= 0 || years <= 0) return "Invalid inputs: start value and years must be positive.";
    const growth = ((endValue / startValue) ** (1 / years) - 1) * 100;
    return `${growth.toFixed(2)}% per year`;
  },
  {
    name: "cagr",
    description: "Compound annual growth rate between two values over a number of years.",
    schema: cagrSchema,
  }
);
