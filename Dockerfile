FROM node:10-slim

# Labels for GitHub to read the action
LABEL "com.github.actions.name"="Clerk"
LABEL "com.github.actions.description"="Verify PRs have release notes."
LABEL "com.github.actions.icon"="clipboard"
LABEL "com.github.actions.color"="gray-dark"

# Copy the package.json and package-lock.json
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn

# Copy the rest of your action's code
COPY . .

# Typescript Compilation
RUN yarn build

# Run `node /entrypoint.js`
ENTRYPOINT ["node", "/lib/index.js"]
