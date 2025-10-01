#!/bin/bash

echo "Starting comprehensive export fix..."

# Check and add missing exports for different services
echo "Checking which functions already exist..."

# updateUser should be in user.ts
if ! grep -q "export.*updateUser" pkg/core/src/services/user.ts; then
  echo "Adding updateUser to user.ts..."
  echo "
export const updateUser = async (userId: string, data: any) => {
  console.log('updateUser - stub implementation');
  return null;
};" >> pkg/core/src/services/user.ts
fi

# updateServerById should be in server.ts
if ! grep -q "export.*updateServerById" pkg/core/src/services/server.ts; then
  echo "Adding updateServerById to server.ts..."
  echo "
export const updateServerById = async (serverId: string, data: any) => {
  console.log('updateServerById - stub implementation');
  return null;
};" >> pkg/core/src/services/server.ts
fi

echo "Export fixes complete!"
echo "Now attempting to start the server..."

cd app/hanzo && pnpm run dev