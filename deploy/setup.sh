#!/bin/bash
# One-time setup for deploy webhook
# Run as root from /opt/krawings-portal

set -e

echo "=== Setting up deploy webhook ==="

# Copy systemd service
cp deploy/krawings-deploy.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable krawings-deploy
systemctl start krawings-deploy

echo ""
echo "Deploy webhook is now running on port 9000."
echo ""
echo "Next steps:"
echo "  1. Go to https://github.com/erxu168/Odoo_Portal_18EE/settings/hooks/new"
echo "  2. Payload URL: http://test18ee.krawings.de:9000/deploy"
echo "  3. Content type: application/json"
echo "  4. Secret: krawings-deploy-2026"
echo "  5. Events: Just the push event"
echo "  6. Click Add webhook"
echo ""
echo "Test: curl http://test18ee.krawings.de:9000/health"
echo "Status: curl http://test18ee.krawings.de:9000/status"
