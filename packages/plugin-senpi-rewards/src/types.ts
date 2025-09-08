import { z } from "zod";

export const TransferEthSchema = z.object({
    amount: z.number().min(0),
    toAddress: z.string(),
    isENS: z.boolean(),
});
