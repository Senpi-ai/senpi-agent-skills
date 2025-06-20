type CreatePriceAlertSubscriptionInput = {
    userId?: string | null;
    externalReferenceId?: string | null;
    chainId?: string | null;
    tokenAddress?: string | null;
    tokenSymbol?: string | null;
    recurrence?: string | null;
    notificationCallbackTopic?: string | null;
    currentPriceUsd?: number | null;
    conditions?: { lt?: number | null };
    requestType?: string | null;
    expiresAtEpochMs?: number | null;
};

type CreatePriceAlertSubscriptionResponse = {
    data?: {
        CreatePriceAlertSubscription: {
            subscriptionId: string;
            metadata: {
                traceId: string;
                webhookId: string;
            };
        };
    };
    errors?: any;
};

export async function createPriceAlertSubscription(
    input: CreatePriceAlertSubscriptionInput,
    apiUrl: string,
    apiKey?: string
): Promise<CreatePriceAlertSubscriptionResponse> {
    const mutation = `
        mutation CreatePriceAlertSubscription($input: CreatePriceAlertSubscriptionInput!) {
            CreatePriceAlertSubscription(input: $input) {
                subscriptionId
                metadata {
                    traceId
                    webhookId
                }
            }
        }
    `;

    const body = JSON.stringify({
        query: mutation,
        variables: { input }
    });

    const headers: Record<string, string> = {
        "Content-Type": "application/json"
    };
    if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch(apiUrl, {
        method: "POST",
        headers,
        body
    });

    const result = await response.json();
    return result;
}
