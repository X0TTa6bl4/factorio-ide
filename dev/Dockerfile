# Версии держать вместе с dev/versions.env
FROM mcr.microsoft.com/playwright:v1.56.1-noble@sha256:f1e7e01021efd65dd1a2c56064be399f3e4de00fd021ac561325f2bfbb2b837a

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NODE_PATH=/opt/f-logic-dev/node_modules \
    PATH="/opt/f-logic-dev/node_modules/.bin:${PATH}" \
    HOME=/tmp \
    npm_config_cache=/tmp/npm-cache \
    npm_config_update_notifier=false \
    F_LOGIC_DEV_PACKAGE=/opt/f-logic-dev/package.json

WORKDIR /opt/f-logic-dev
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --engine-strict \
    && npm cache clean --force \
    && chmod -R a+rX /opt/f-logic-dev
COPY entrypoint.sh /opt/f-logic-dev/entrypoint.sh
RUN chmod 755 /opt/f-logic-dev/entrypoint.sh \
    && mkdir -p /workspace \
    && chmod 755 /workspace

WORKDIR /workspace
ENTRYPOINT ["/opt/f-logic-dev/entrypoint.sh"]
CMD ["node", "dev/commands.mjs", "test"]
