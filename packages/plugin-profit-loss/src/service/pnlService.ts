import { DuneClient } from "@duneanalytics/client-sdk";
import { PnlData } from "../types/type";
import { elizaLogger } from "@moxie-protocol/core";

const client = new DuneClient(process.env.DUNE_API_KEY!);

/**
 * Prepares a SQL query to fetch PnL data from Dune Analytics based on wallet response parameters
 *
 * @param pnlResponse - Object containing query parameters
 * @param pnlResponse.walletAddresses - Array of wallet addresses to filter by
 * @param pnlResponse.moxieUserIds - Array of Moxie user IDs to filter by
 * @param pnlResponse.tokenAddresses - Array of token contract addresses to filter by
 * @param pnlResponse.analysisType - Type of analysis to perform ('PROFIT'|'LOSS')
 * @param pnlResponse.maxResults - Maximum number of results to return (defaults to 15)
 * @param pnlResponse.chain - Blockchain network to query (e.g. 'base')
 * @returns SQL query string for fetching PnL data
 */
const BLACKLISTED_TOKEN_ADDRESSES = [
  "0x0000000000000000000000000000000000000000",
  "0x4200000000000000000000000000000000000006",
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
  "0x820c137fa70c8691f0e44dc420a5e53c168921dc",
  "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452",
  "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
  "0x04c0599ae5a44757c0af6f9ec3b93da8976c150a",
  "0x5875eee11cf8398102fdad704c9e96607675467a",
  "0x3128a0f7f0ea68e7b7c9b00afa7e41045828e858",
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca"
];

const RESULT_BASE_PNL_TABLE =
  process.env.RESULT_BASE_PNL_TABLE || "dune.senpi.result_pnl_analysis";

/**
 * Prepares a SQL query specifically for group PnL data
 * 
 * @param pnlResponse - Object containing query parameters
 * @param pnlResponse.groupMembers - Array of group member objects containing groupId and memberIds
 * @param pnlResponse.analysisType - Type of analysis to perform ('PROFIT'|'LOSS')
 * @param pnlResponse.maxResults - Maximum number of results to return
 * @param pnlResponse.timeFrame - Time frame for the PnL data
 * @returns SQL query string for fetching group PnL data
 */
export const prepareGroupPnlQuery = (traceId: string, pnlResponse: any) => {
  const { groupMembers, analysisType, maxResults, timeFrame } = pnlResponse;

  let pnlGroupTable = RESULT_BASE_PNL_TABLE;
  if (timeFrame === "1d") {
    pnlGroupTable += "_1d";
  } else if (timeFrame === "7d") {
    pnlGroupTable += "_7d";
  } else if (timeFrame === "30d") {
    pnlGroupTable += "_30d";
  } else {
    pnlGroupTable += "_lifetime";
  }

  pnlGroupTable = pnlGroupTable + "_" + process.env.PNL_ENV;
  elizaLogger.debug(`[prepareGroupPnlQuery] traceId: ${traceId}, Pnl table: ${pnlGroupTable}`);

  const allMemberIds = groupMembers.flatMap(group => group.memberIds);
  const memberIdsString = allMemberIds.map(id => `'${id}'`).join(",");

  const blacklistedTokensString = BLACKLISTED_TOKEN_ADDRESSES.map(
    (address) => `${address}`
  ).join(",");

  const query = `
     WITH ranked_usernames AS (
      SELECT
          moxie_user_id,
          username,
          username_type,
          ROW_NUMBER() OVER (
              PARTITION BY moxie_user_id 
              ORDER BY 
                  CASE username_type
                      WHEN 'farcaster_name' THEN 1
                      WHEN 'ens_name' THEN 2
                      WHEN 'basename' THEN 3
                      WHEN 'moxie_user_id' THEN 4
                      WHEN 'wallet_address' THEN 5
                      ELSE 6
                  END
          ) AS rn
      FROM ${pnlGroupTable}
      WHERE moxie_user_id IS NOT NULL
    ),
    aggregated_pnl AS (
      SELECT
          moxie_user_id,
          SUM(total_buy_value_usd) AS total_buy_usd,
          SUM(total_sell_value_usd) AS total_sell_usd,
          SUM(profit_loss) AS pnl_usd
      FROM ${pnlGroupTable}
      WHERE 
          moxie_user_id IS NOT NULL
          AND token_address NOT IN (${blacklistedTokensString})
          AND buy_transaction_count > 0
          AND moxie_user_id IN (${memberIdsString})
      GROUP BY moxie_user_id
    ),
    best_usernames AS (
      SELECT
          moxie_user_id,
          username,
          username_type
      FROM ranked_usernames
      WHERE rn = 1
    )
    SELECT 
      a.moxie_user_id AS moxie_user_id,
      b.username,
      b.username_type,
      a.total_buy_usd,
      a.total_sell_usd,
      a.pnl_usd
    FROM aggregated_pnl a
    LEFT JOIN best_usernames b
      ON a.moxie_user_id = b.moxie_user_id
    ORDER BY a.pnl_usd DESC
  `;
  elizaLogger.debug(`[prepareGroupPnlQuery] traceId: ${traceId}, query: ${query}`);
  return query;
};

export const preparePnlQuery = (pnlResponse: any) => {
  const {
    walletAddresses,
    moxieUserIds,
    tokenAddresses,
    analysisType,
    maxResults,
    timeFrame,
  } = pnlResponse;

  const buildWhereClause = (
    field: string,
    values: string[],
    isTokenOrWallet: boolean
  ) => {
    return isTokenOrWallet
      ? `${field} in (${values.map((value) => `${value}`).join(",")})`
      : `${field} in (${values.map((value) => `'${value}'`).join(",")})`;
  };

  const buildSelectFields = (isAggregated: boolean) => {
    return isAggregated
      ? `username, max(wallet_address) as wallet_address, moxie_user_id, token_address, SUM(profit_loss) as total_profit_loss, MAX(token_sold_symbol) as token_sold_symbol, MAX(token_bought_symbol) as token_bought_symbol, SUM(total_sell_amount) as total_sell_amount, SUM(total_buy_amount) as total_buy_amount, SUM(total_sell_value_usd) as total_sell_value_usd, SUM(total_buy_value_usd) as total_buy_value_usd, SUM(buy_transaction_count) as buy_transaction_count, SUM(sell_transaction_count) as sell_transaction_count`
      : `username, moxie_user_id, token_address, profit_loss, token_sold_symbol, token_bought_symbol, total_sell_amount, total_buy_amount, total_sell_value_usd, total_buy_value_usd, buy_transaction_count, sell_transaction_count`;
  };

  const buildGroupByClause = (fields: string[]) => {
    return fields.length > 0 ? ` group by ${fields.join(", ")}` : "";
  };

  const buildOrderByClause = (analysisType: string, isAggregated: boolean) => {
    return isAggregated
      ? `total_profit_loss ${analysisType === "PROFIT" ? "desc" : "asc"}`
      : `profit_loss ${analysisType === "PROFIT" ? "desc" : "asc"}`;
  };

  let selectFields = buildSelectFields(false);

  let pnlTable = RESULT_BASE_PNL_TABLE;
  if (timeFrame === "1d") {
    pnlTable += "_1d";
  } else if (timeFrame === "7d") {
    pnlTable += "_7d";
  } else if (timeFrame === "30d") {
    pnlTable += "_30d";
  } else {
    pnlTable += "_lifetime";
  }

  elizaLogger.debug(`[preparePnlQuery] Pnl env: ${process.env.PNL_ENV}`);
  pnlTable = pnlTable + "_" + process.env.PNL_ENV;
  elizaLogger.debug(`[preparePnlQuery] Pnl table: ${pnlTable}`);

  let query = `select ${selectFields} from ${pnlTable}`;
  const whereClauses = [];
  const groupByClauses = [];
  let orderByClause = "";

  if (BLACKLISTED_TOKEN_ADDRESSES.length > 0) {
    whereClauses.push(
      `token_address not in (${BLACKLISTED_TOKEN_ADDRESSES.map(
        (address) => `${address}`
      ).join(",")})`
    );
  }

  if (walletAddresses?.length > 0) {
    whereClauses.push(
      buildWhereClause("wallet_address", walletAddresses, true)
    );
  }

  if (moxieUserIds?.length > 0) {
    whereClauses.push(buildWhereClause("moxie_user_id", moxieUserIds, false));
  }

  if (tokenAddresses?.length > 0) {
    whereClauses.push(
      buildWhereClause("token_address", tokenAddresses, true)
    );
  }

  const isAggregated = moxieUserIds?.length > 0 || tokenAddresses?.length > 0;

  if (isAggregated) {
    selectFields = buildSelectFields(true);
    query = `select ${selectFields} from ${pnlTable}`;
    groupByClauses.push("token_address", "moxie_user_id", "username");
    orderByClause = buildOrderByClause(analysisType, true);
  } else {
    orderByClause = buildOrderByClause(analysisType, false);
  }

  if (whereClauses.length > 0) {
    query += ` where ${whereClauses.join(" and ")} and buy_transaction_count > 0`;
  } else {
    query += ` where buy_transaction_count > 0`;
  }

  query += buildGroupByClause(groupByClauses);

  if (orderByClause) {
    query += ` order by ${orderByClause}`;
  }

  query += ` limit ${maxResults || 20}`;

  elizaLogger.debug(`[preparePnlQuery] query: ${query}`);
  return query;
};

/**
 * Fetches PnL data from Dune Analytics using a prepared SQL query
 *
 * @param query - SQL query string for fetching PnL data
 * @returns Array of PnL data objects
 */
export const fetchPnlData = async (query: string) => {
  let retries = 3;
  let lastError;
  let start = new Date();
  while (retries > 0) {
    try {
      const result = await client.runSql({ query_sql: query });

      const pnlData = result.result.rows as unknown as PnlData[];

      elizaLogger.debug(`[fetchPnlData] PnL data: ${pnlData.length} rows`);
      elizaLogger.debug(
        `[fetchPnlData] time taken to fetch pnl data: ${
          new Date().getTime() - start.getTime()
        }ms`
      );
      return pnlData;
    } catch (error) {
      lastError = error;
      elizaLogger.error(
        `[fetchPnlData] Error fetching PnL data (${4 - retries}/3 attempts): ${error}`
      );
      retries--;

      if (retries > 0) {
        // Wait 1 second before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  // If we get here, all retries failed
  throw lastError;
};

/**
 * Fetches total PnL from Dune Analytics using a prepared SQL query
 *
 * @param query - SQL query string for fetching total PnL data
 * @returns Total PnL value
 */
export const fetchTotalPnl = async (pnlResponse: any) => {
  let retries = 3;
  let delay = 1000; // Start with 1 second delay
  let lastError;

  const { walletAddresses, moxieUserIds, timeFrame } = pnlResponse;

  let pnlTable = RESULT_BASE_PNL_TABLE;
  if (timeFrame === "1d") {
    pnlTable += "_1d";
  } else if (timeFrame === "7d") {
    pnlTable += "_7d";
  } else if (timeFrame === "30d") {
    pnlTable += "_30d";
  } else {
    pnlTable += "_lifetime";
  }

  elizaLogger.debug(`[fetchTotalPnl] Pnl env: ${process.env.PNL_ENV}`);
  pnlTable = pnlTable + "_" + process.env.PNL_ENV;
  elizaLogger.debug(`[fetchTotalPnl] Pnl table: ${pnlTable}`);

  let query = `select SUM(profit_loss) as total_profit_loss from ${pnlTable}`;
  let start = new Date();
  let conditions = [];

  if (walletAddresses?.length > 0) {
    conditions.push(
      `wallet_address in (${walletAddresses
        .map((address) => `${address}`)
        .join(",")})`
    );
  }
  if (moxieUserIds?.length > 0) {
    conditions.push(
      `moxie_user_id in (${moxieUserIds.map((id) => `'${id}'`).join(",")})`
    );
  }
  if (BLACKLISTED_TOKEN_ADDRESSES.length > 0) {
    conditions.push(
      `token_address not in (${BLACKLISTED_TOKEN_ADDRESSES.map(
        (token) => `${token}`
      ).join(",")})`
    );
  }

  if (conditions.length > 0) {
    query += ` where ${conditions.join(" and ")}`;
  }
  elizaLogger.debug(`[fetchTotalPnl] query: ${query}`);

  while (retries > 0) {
    try {
      const result = await client.runSql({ query_sql: query });
      const totalPnl = result.result.rows[0].total_profit_loss;
      elizaLogger.debug(
        `[fetchTotalPnl] time taken to fetch total pnl: ${
          new Date().getTime() - start.getTime()
        }ms`
      );
      return totalPnl as number;
    } catch (error) {
      lastError = error;
      elizaLogger.error(
        `[fetchTotalPnl] Error fetching total PnL (${4 - retries}/3 attempts): ${error}`
      );
      retries--;

      if (retries > 0) {
        // Wait for the current delay before retrying
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff: double the delay for the next retry
      }
    }
  }

  // If we get here, all retries failed
  throw lastError;
};
