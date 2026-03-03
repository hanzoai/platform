# Development-friendly image for hanzoai/platform:dev
FROM hanzoai/os:latest
WORKDIR /workspace

# Set development environment
ENV NODE_ENV=development
ENV PATH="/workspace/node_modules/.bin:${PATH}"

# Expose application port
EXPOSE 3000

CMD ["sh", "-c", "pnpm run hanzo:dev"]
