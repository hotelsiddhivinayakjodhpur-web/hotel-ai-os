import { env } from "@/lib/env";
import { agentRepository } from "@/server/repositories/agent.repository";
import { dbConfigured, safeDb } from "./db-guard";

export interface SystemStatus {
  hotelName: string;
  integrations: {
    bookingEngine: boolean;
    channelManager: boolean;
    database: boolean;
    googleAnalytics: boolean;
    searchConsole: boolean;
  };
  totalAgents: number;
  activeAgents: number;
  agentsHealthy: boolean;
}

/** System posture for the top bar + landing tiles. No external calls. */
export async function getSystemStatus(): Promise<SystemStatus> {
  const agents = await safeDb(() => agentRepository.list(), []);
  const activeAgents = agents.filter((a) => a.enabled && a.status !== "FAILED").length;
  const agentsHealthy = agents.length === 0 || agents.every((a) => a.health >= 60);

  return {
    hotelName: "Hotel Siddhi Vinayak",
    integrations: {
      bookingEngine: Boolean(env.STAYFLEXI_BE_API_KEY && env.STAYFLEXI_GROUP_ID),
      channelManager: Boolean(env.STAYFLEXI_CM_API_KEY && env.STAYFLEXI_PMS_ID),
      database: dbConfigured,
      googleAnalytics: Boolean(env.GA4_PROPERTY_ID),
      searchConsole: Boolean(env.GSC_SITE_URL),
    },
    totalAgents: agents.length,
    activeAgents,
    agentsHealthy,
  };
}
