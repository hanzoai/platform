// Database utility functions
import { sql } from "drizzle-orm";

export async function db() {
  // Return a mock database connection for now
  return {
    execute: async (query: any) => {
      console.warn("db.execute called - returning empty result (stub)");
      return { rows: [] };
    },
    query: async (query: any) => {
      console.warn("db.query called - returning empty result (stub)");
      return { rows: [] };
    },
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([])
        })
      })
    }),
    insert: () => ({
      values: () => Promise.resolve()
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve()
      })
    }),
    delete: () => ({
      where: () => Promise.resolve()
    })
  };
}

export default db;