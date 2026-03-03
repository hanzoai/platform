import type { NextApiRequest, NextApiResponse } from "next";

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  return res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
};

export default handler;
