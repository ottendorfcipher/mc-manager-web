#!/usr/bin/env bash
set -euo pipefail

# Setup script for redstoneCipher OAuth credentials
# Securely prompts for Google Client ID and Secret, generates JWT secret,
# and writes to .env file

ENV_FILE=".env"
ENV_EXAMPLE=".env.example"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  redstoneCipher OAuth Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "This script will help you configure Google OAuth credentials."
echo ""
echo "Prerequisites:"
echo "  1. Go to https://console.cloud.google.com"
echo "  2. Navigate to: APIs & Services → Credentials"
echo "  3. Create OAuth 2.0 Client ID (Web application)"
echo "  4. Add authorized JavaScript origins:"
echo "     - http://localhost:8787 (dev)"
echo "     - http://localhost:5173 (dev, Vite)"
echo "     - https://redstonecipher.com (production)"
echo "  5. Add authorized redirect URIs:"
echo "     - http://localhost:8787/auth/callback (dev)"
echo "     - https://redstonecipher.com/auth/callback (production)"
echo ""
read -p "Press Enter when ready to continue..."
echo ""

# Check if .env already exists
if [ -f "$ENV_FILE" ]; then
    echo "⚠️  Warning: $ENV_FILE already exists."
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Setup cancelled. Your existing .env file was not modified."
        exit 0
    fi
    echo ""
fi

# Copy from example if it exists
if [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    echo "✓ Created $ENV_FILE from $ENV_EXAMPLE"
else
    echo "⚠️  Warning: $ENV_EXAMPLE not found. Creating new .env file."
    cat > "$ENV_FILE" << 'EOF'
# redstoneCipher Configuration
DATABASE_URL=sqlite:///Users/nicholasweiner/Desktop/mc-manager-web/mc-manager.db

# OAuth & Auth (required)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
JWT_SECRET=

# Server settings (optional overrides)
HOST=127.0.0.1
PORT=8787
REDIRECT_URI=https://redstonecipher.com/auth/callback

# GCP settings (defaults shown)
GCP_PROJECT=minecraft-493201
GCP_ZONE=us-central1-a
GCP_INSTANCE=mc-server-spot
TAILSCALE_IP=100.80.114.91
EOF
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Step 1: Google Client ID"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Enter your Google Client ID (ends with .apps.googleusercontent.com):"
read -r CLIENT_ID

if [ -z "$CLIENT_ID" ]; then
    echo "❌ Error: Client ID cannot be empty."
    rm -f "$ENV_FILE"
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Step 2: Google Client Secret"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Enter your Google Client Secret (input will be hidden):"
read -s -r CLIENT_SECRET
echo ""  # newline after hidden input

if [ -z "$CLIENT_SECRET" ]; then
    echo "❌ Error: Client Secret cannot be empty."
    rm -f "$ENV_FILE"
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Step 3: JWT Secret"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Generating secure random JWT secret..."

# Generate 32-byte (256-bit) random hex string
JWT_SECRET=$(openssl rand -hex 32)

if [ -z "$JWT_SECRET" ]; then
    echo "❌ Error: Failed to generate JWT secret."
    rm -f "$ENV_FILE"
    exit 1
fi

echo "✓ Generated JWT secret (64 hex characters)"

# Update .env file with the values
# Use different delimiters for sed to avoid conflicts with special chars
echo ""
echo "Writing credentials to $ENV_FILE..."

# Escape special characters in the values for sed
CLIENT_ID_ESCAPED=$(printf '%s\n' "$CLIENT_ID" | sed 's/[&/\]/\\&/g')
CLIENT_SECRET_ESCAPED=$(printf '%s\n' "$CLIENT_SECRET" | sed 's/[&/\]/\\&/g')
JWT_SECRET_ESCAPED=$(printf '%s\n' "$JWT_SECRET" | sed 's/[&/\]/\\&/g')

# Update the .env file
sed -i '' "s|^GOOGLE_CLIENT_ID=.*|GOOGLE_CLIENT_ID=$CLIENT_ID_ESCAPED|" "$ENV_FILE"
sed -i '' "s|^GOOGLE_CLIENT_SECRET=.*|GOOGLE_CLIENT_SECRET=$CLIENT_SECRET_ESCAPED|" "$ENV_FILE"
sed -i '' "s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET_ESCAPED|" "$ENV_FILE"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Setup Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Your credentials have been saved to $ENV_FILE"
echo ""
echo "Next steps:"
echo "  1. Review $ENV_FILE and adjust any optional settings"
echo "  2. Run the migration: ./migrate.sh"
echo "  3. Start the server:"
echo "     - Development: cd backend && cargo run"
echo "     - Production:  cd backend && cargo build --release"
echo ""
echo "⚠️  Security reminder:"
echo "  - Never commit .env to git (already in .gitignore)"
echo "  - Keep your Client Secret confidential"
echo "  - Rotate secrets if they are ever exposed"
echo ""
