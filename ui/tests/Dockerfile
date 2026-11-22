FROM mcr.microsoft.com/playwright:v1.56.1-noble
WORKDIR /opt/ui-check
RUN npm init -y && npm install --save-exact playwright@1.56.1 axe-core@4.10.3
WORKDIR /workspace
CMD ["node", "ui/tests/check.mjs"]
