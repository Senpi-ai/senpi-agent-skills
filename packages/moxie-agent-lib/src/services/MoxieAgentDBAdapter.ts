import { PostgresDatabaseAdapter } from "@elizaos/adapter-postgres";
import { elizaLogger } from "@moxie-protocol/core";
import { IAgentRuntime } from "@moxie-protocol/core";
import { v4 as uuidv4 } from "uuid";
import { ethers } from "ethers";
import { CampaignTokenDetails, Skill } from "./types";

export class MoxieAgentDBAdapter extends PostgresDatabaseAdapter {
    private pgAdapter: PostgresDatabaseAdapter;
    constructor(connectionConfig: any) {
        super(connectionConfig);
        this.pgAdapter = new PostgresDatabaseAdapter(connectionConfig);
    }

    async getFreeTrailBalance(
        userId: string,
        pluginId: string,
        totalFreeQueries: number = 10,
        remainingFreeQueries: number = 10
    ): Promise<{ user_id: string; plugin_id: string; total_free_queries: number; remaining_free_queries: number }> {
        return this.pgAdapter
            .query(
                `SELECT * FROM free_usage_details WHERE user_id = $1 AND plugin_id = $2`,
                [userId, pluginId]
            )
            .then((result) => {
                if (result.rows.length > 0) {
                    return {
                        user_id: userId,
                        plugin_id: pluginId,
                        total_free_queries: result.rows[0].total_free_queries,
                        remaining_free_queries: result.rows[0].remaining_free_queries
                    };
                } else {
                    return this.pgAdapter
                        .query(
                            `INSERT INTO free_usage_details (id, user_id, plugin_id, total_free_queries, remaining_free_queries) VALUES ($1, $2, $3, $4, $5) RETURNING total_free_queries, remaining_free_queries`,
                            [
                                uuidv4(),
                                userId,
                                pluginId,
                                totalFreeQueries,
                                remainingFreeQueries,
                            ]
                        )
                        .then((insertResult) => ({
                            user_id: userId,
                            plugin_id: pluginId,
                            total_free_queries: insertResult.rows[0].total_free_queries,
                            remaining_free_queries: insertResult.rows[0].remaining_free_queries,
                        }));
                }
            });
    }

    async deductFreeTrail(userId: string, pluginId: string): Promise<{ user_id: string; plugin_id: string; total_free_queries: number; remaining_free_queries: number }> {
        return this.pgAdapter
            .query(
                `UPDATE free_usage_details SET remaining_free_queries = remaining_free_queries - 1 WHERE user_id = $1 AND plugin_id = $2 RETURNING total_free_queries, remaining_free_queries`,
                [userId, pluginId]
            )
            .then((result) => {
                if (result.rows.length > 0) {
                    return {
                        user_id: userId,
                        plugin_id: pluginId,
                        total_free_queries: result.rows[0].total_free_queries,
                        remaining_free_queries: result.rows[0].remaining_free_queries,
                    };
                } else {
                    return {
                        user_id: userId,
                        plugin_id: pluginId,
                        total_free_queries: 0,
                        remaining_free_queries: -1,
                    };
                }
            });
    }

    async upsertFreeTrialBalance(userId: string, pluginId: string, total_free_queries: number): Promise<{ user_id: string; plugin_id: string; total_free_queries: number; remaining_free_queries: number }> {
        return this.pgAdapter
            .query(
                `
                INSERT INTO free_usage_details (id, user_id, plugin_id, total_free_queries, remaining_free_queries)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (user_id, plugin_id) DO UPDATE
                SET remaining_free_queries = free_usage_details.remaining_free_queries - 1,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING total_free_queries, remaining_free_queries;
                `,
                [
                    uuidv4(),
                    userId,
                    pluginId,
                    total_free_queries,
                    total_free_queries - 1,
                ]
            )
            .then((result) => {
                if (result.rows.length > 0) {
                    return {
                        user_id: userId,
                        plugin_id: pluginId,
                        total_free_queries: result.rows[0].total_free_queries,
                        remaining_free_queries:
                            result.rows[0].remaining_free_queries,
                    };
                } else {
                    return {
                        user_id: userId,
                        plugin_id: pluginId,
                        total_free_queries: total_free_queries,
                        remaining_free_queries: 0,
                    };
                }
            });
    }

    async createUserAgentFeedback(roomId: string, messageId: string, moxieUserId: string, agentId: string, feedback: string, rating: number, feedbackText: string, screenshotUrl: string): Promise<string> {
        return this.pgAdapter
            .query(
                `INSERT INTO user_agent_feedback (room_id, message_id, moxie_user_id, agent_id, feedback, rating, feedback_text, screenshot_url)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (message_id, moxie_user_id) DO UPDATE
                 SET feedback = $5,
                     feedback_text = $7,
                     rating = $6,
                     updated_at = CURRENT_TIMESTAMP
                 RETURNING id`,
                [roomId, messageId, moxieUserId, agentId, feedback, rating, feedbackText, screenshotUrl]
            )
            .then((result) => {
                return result.rows[0].id;
            })
            .catch((error) => {
                console.error(
                    "Error while creating user agent feedback:",
                    error
                );
                throw error;
            });
    }

    async getSkillById(skillId: string): Promise<Skill | null> {
        const skillsTableName = process.env.SKILLS_TABLE_NAME || "skills";
        const query = `SELECT * FROM ${skillsTableName} WHERE id = $1`;
        return this.pgAdapter.query(query, [skillId]).then((result) => {
            if (result.rows.length > 0) {
                const row = result.rows[0];
                let skill: Skill = {
                    id: row.id,
                    name: row.name,
                    displayName: row.display_name,
                    version: row.version,
                    author: row.author,
                    description: row.description,
                    githubUrl: row.github_url,
                    logoUrl: row.logo_url,
                    status: row.status,
                    isDefault: row.is_default,
                    installedStatus: row.installed_status,
                    settings: row.settings,
                    capabilities: row.capabilities,
                    starterQuestions: row.starter_questions,
                    mediaUrls: row.media_urls,
                    actions: row.actions,
                    isPremium: row.is_premium,
                    freeQueries: row.free_queries,
                    skillCoinAddress: row.skill_coin_address,
                    minimumSkillBalance: row.minimum_skill_balance,
                    isFeatured: row.is_featured,
                    loaders: row.loaders,
                };
                return skill;
            } else {
                return null;
            }
        });
    }

    async getSkillByAction(action: string): Promise<Skill | null> {
        const skillsTableName = process.env.SKILLS_TABLE_NAME || "skills";
        const query = `SELECT * FROM ${skillsTableName} WHERE actions @> ARRAY[$1]`;
        return this.pgAdapter.query(query, [action]).then((result) => {
            if (result.rows.length > 0) {
                const row = result.rows[0];
                let skill: Skill = {
                    id: row.id,
                    name: row.name,
                    displayName: row.display_name,
                    version: row.version,
                    author: row.author,
                    description: row.description,
                    githubUrl: row.github_url,
                    logoUrl: row.logo_url,
                    status: row.status,
                    isDefault: row.is_default,
                    installedStatus: row.installed_status,
                    settings: row.settings,
                    capabilities: row.capabilities,
                    starterQuestions: row.starter_questions,
                    mediaUrls: row.media_urls,
                    actions: row.actions,
                    isPremium: row.is_premium,
                    freeQueries: row.free_queries,
                    skillCoinAddress: row.skill_coin_address,
                    minimumSkillBalance: row.minimum_skill_balance,
                    isFeatured: row.is_featured,
                    loaders: row.loaders,
                };
                return skill;
            } else {
                return null;
            }
        });
    }

    async getSkills(
        userId: string = "",
        installed_status: string = ""
    ): Promise<Skill[]> {
        const skillsTableName = process.env.SKILLS_TABLE_NAME || "skills";
        const userSkillsTableName = process.env.USER_SKILLS_TABLE_NAME || "user_skills";
        let selectFields = [
            "DISTINCT ON (s.order_index) s.id",
            "s.name",
            "s.display_name",
            "s.version",
            "s.author",
            "s.description",
            "s.github_url",
            "s.logo_url",
            "s.settings",
            "s.capabilities",
            "s.starter_questions",
            "s.media_urls",
            "s.actions",
            "s.is_premium",
            "s.free_queries",
            "s.skill_coin_address",
            "s.minimum_skill_balance",
            "s.status",
            "s.is_default",
            "s.is_featured",
            "s.loaders",
        ];
        if (userId !== "") {
            selectFields.push(
                `CASE WHEN s.is_default = true THEN 'INSTALLED' ELSE COALESCE(us.status, 'UNINSTALLED') END AS installed_status`
            );
        }
        let query = `SELECT ${selectFields.join(", ")} FROM ${skillsTableName} s `;
        if (userId !== "") {
            query += ` LEFT JOIN ${userSkillsTableName} us ON s.id = us.skill_id AND us.user_id = '${userId}'`;
        }
        if (installed_status !== "") {
            query += ` WHERE s.status = 'ACTIVE' AND (COALESCE(us.status, 'UNINSTALLED') = '${installed_status}' ${installed_status == "INSTALLED" ? "OR s.is_default = true" : "AND s.is_default = false"})`;
        } else {
            query += ` WHERE s.status = 'ACTIVE'`;
        }
        query += ` ORDER BY s.order_index, s.updated_at DESC`;
        elizaLogger.debug(`[getSkills] [${userId}] Query: ${query}`);
        return this.pgAdapter.query(query, []).then((result) => {
            return result.rows.map((row) => ({
                id: row.id,
                name: row.name,
                displayName: row.display_name,
                version: row.version,
                author: row.author,
                description: row.description,
                githubUrl: row.github_url,
                logoUrl: row.logo_url,
                status: row.status,
                isDefault: row.is_default,
                installedStatus: row.installed_status,
                settings: row.settings,
                capabilities: row.capabilities,
                starterQuestions: row.starter_questions,
                mediaUrls: row.media_urls,
                actions: row.actions,
                isPremium: row.is_premium,
                freeQueries: row.free_queries,
                skillCoinAddress: row.skill_coin_address,
                minimumSkillBalance: row.minimum_skill_balance,
                isFeatured: row.is_featured,
                loaders: row.loaders,
            }));
        });
    }

    async installSkill(
        userId: string,
        skillId: string,
        status: string
    ): Promise<void> {
        const userSkillsTableName = process.env.USER_SKILLS_TABLE_NAME || "user_skills";
        // This query inserts a new record into the user_skills table with a generated UUID, user_id, skill_id, status, and timestamps.
        // If a conflict occurs on user_id and skill_id (i.e., the user already has this skill), it updates the status and updated_at fields
        // only if the existing status is different from the new status.
        return this.pgAdapter
            .query(
                `
            INSERT INTO ${userSkillsTableName} (id, user_id, skill_id, status, created_at, updated_at)
            VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW())
            ON CONFLICT (user_id, skill_id)
            DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
            WHERE ${userSkillsTableName}.status <> EXCLUDED.status;`,
                [userId, skillId, status]
            )
            .then((result) => {
                if (result.rowCount === 0) {
                    throw new Error(`User ${userId} already set this status ${status} for skill ${skillId}`);
                }
                return null;
            })
            .catch((error) => {
                console.error("Error while installing skill:", error);
                throw error;
            });
    }

    async getLimitOrderDetails(orderId: string): Promise<{ wallet_address: string, order_id: string, status: string}> {
        return this.pgAdapter
            .query(`SELECT wallet_address, order_id, status FROM limit_orders WHERE order_id = $1`, [orderId])
            .then((result) => {
                if (result.rows.length > 0) {
                    return result.rows[0];
                } else {
                    return null;
                }
            });
    }

    async updateLimitOrder(orderId: string, status: string): Promise<number> {
        return this.pgAdapter
            .query(`UPDATE limit_orders SET status = $1, updated_at = now() WHERE order_id = $2`, [status, orderId])
            .then((result) => {
                return result.rowCount || 0 ;
            }).catch((error) => {
                console.error("Error while updating limit order:", error);
                throw error;
            });
    }

    async getLimitOrderDetailsMultiple(orderIds: string[]): Promise<{ wallet_address: string, order_id: string, status: string}[]> {
        return this.pgAdapter
            .query(`SELECT wallet_address, order_id, status FROM limit_orders WHERE order_id = ANY($1)`, [orderIds])
            .then((result) => {
                return result.rows;
            });
    }

    async updateLimitOrders(orderIds: string[], status: string): Promise<number> {
        return this.pgAdapter
            .query(`UPDATE limit_orders SET status = $1, updated_at = now() WHERE order_id = ANY($2)`, [status, orderIds])
            .then((result) => {
                return result.rowCount || 0 ;
            }).catch((error) => {
                console.error("Error while updating limit order:", error);
                throw error;
            });
    }

    async getCampaignTokenDetails(): Promise<CampaignTokenDetails[]> {
        return this.pgAdapter
            .query(
                `SELECT
                    token_address as "tokenAddress",
                    token_symbol as "tokenSymbol",
                    type,
                    minimum_balance as "minimumBalance",
                    start_date as "startDate",
                    end_date as "endDate",
                    created_at as "createdAt",
                    updated_at as "updatedAt"
                FROM campaign_tokens
                WHERE now() BETWEEN start_date AND end_date;`
            )
            .then((result) => {
                return result.rows;
            }).catch((error) => {
                console.error("Error while getting campaign token details:", error);
                throw error;
            });
    }

    async saveLimitOrder(orderId: string, walletAddress: string): Promise<string> {
        return this.pgAdapter
            .query(
                `INSERT INTO limit_orders (id, wallet_address, order_id, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)`,
                [uuidv4(), walletAddress, orderId, 'open', new Date(), new Date()]
            )
            .then((result) => {
                return "success";
            })
            .catch((error) => {
                console.error("Error while saving limit order:", error);
                throw error;
            });
    }
}
