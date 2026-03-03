#!/bin/bash

echo "Removing duplicate exports from settings.ts..."

# Remove the duplicate stubs from settings.ts
sed -i '/^export const checkGPUStatus = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const cleanUpUnusedImages = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const getLogCleanupStatus = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const readConfig = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const readConfigInPath = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const readMainConfig = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const readMonitoringConfig = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const parseRawConfig = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const prepareEnvironmentVariables = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const processLogs = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const cleanUpUnusedVolumes = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const sendDockerCleanupNotifications = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const setupGPUSupport = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const spawnAsync = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const startLogCleanup = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const stopLogCleanup = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const updateLetsEncryptEmail = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const updateServerTraefik = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const writeConfig = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const writeMainConfig = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const writeTraefikConfigInPath = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const createDefaultTraefikConfig = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const setupDirectories = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const removeVolumeBackupJob = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const restoreVolume = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const runVolumeBackup = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const scheduleVolumeBackup = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const deployRemoteCompose = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const rebuildCompose = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const rebuildRemoteCompose = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const createDefaultMiddlewares = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const initializeNetwork = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const initSchedules = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const initVolumeBackupsCronJobs = async/d' /home/z/platform/pkg/core/src/services/settings.ts
sed -i '/^export const sendHanzoPlatformRestartNotifications = async/d' /home/z/platform/pkg/core/src/services/settings.ts

echo "Removing duplicate exports from index.ts..."

# Remove ALL the stub exports from index.ts that are duplicates
cat > /tmp/remove-from-index.txt << 'EOF'
export const addNewProject = async
export const checkProjectAccess = async
export const checkUserRepositoryPermissions = async
export const createApplication = async
export const createBackup = async
export const createCompose = async
export const createComposeByTemplate = async
export const createDiscordNotification = async
export const createDomain = async
export const createEmailNotification = async
export const createEnvironment = async
export const createGitea = async
export const createGotifyNotification = async
export const createMariadb = async
export const createMongo = async
export const createMount = async
export const createMysql = async
export const createNtfyNotification = async
export const createPort = async
export const createPostgres = async
export const createPreviewDeployment = async
export const createProject = async
export const createRedirect = async
export const createRedis = async
export const createSchedule = async
export const createSecurityBlockedComment = async
export const createSecurity = async
export const createSlackNotification = async
export const createTelegramNotification = async
export const deleteAllMiddlewares = async
export const findApplicationById = async
export const findComposeById = async
export const findEnvironmentById = async
export const findGiteaById = async
export const findMariadbById = async
export const findMemberById = async
export const findMongoById = async
export const findMySqlById = async
export const findNotificationById = async
export const findPostgresById = async
export const findPreviewDeploymentByApplicationId = async
export const findPreviewDeploymentById = async
export const findPreviewDeploymentsByPullRequestId = async
export const findProjectById = async
export const findRedirectById = async
export const findRedisById = async
export const findRollbackById = async
export const findUserById = async
export const getAdvancedStats = async
export const getBitbucketBranches = async
export const getBitbucketRepositories = async
export const getGiteaBranches = async
export const getGiteaRepositories = async
export const getGithubBranches = async
export const getGithubRepositories = async
export const getGitlabBranches = async
export const getGitlabRepositories = async
export const getLastAdvancedStatsFile = async
export const getServiceContainer = async
export const haveGiteaRequirements = async
export const haveGithubRequirements = async
export const haveGitlabRequirements = async
export const IS_CLOUD = process.env.IS_CLOUD
export const manageDomain = async
export const mechanizeDockerContainer = async
export const readConfig = async
export const readRemoteConfig = async
export const recordAdvancedStats = async
export const removeDirectoryCode = async
export const removeDomain = async
export const removeMonitoringDirectory = async
export const removePreviewDeployment = async
export const removeRedirectById = async
export const removeRollbackById = async
export const removeService = async
export const removeTraefikConfig = async
export const shouldDeploy = async
EOF

while IFS= read -r pattern; do
  sed -i "/$pattern/d" /home/z/platform/pkg/core/src/index.ts
done < /tmp/remove-from-index.txt

echo "Done removing duplicate exports"