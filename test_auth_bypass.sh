#!/bin/bash

echo "=== TESTING PLATFORM AUTH BYPASS ==="
echo "Testing that all dashboard pages are accessible without authentication"
echo ""

BASE_URL="http://localhost:3000"

# Function to test a URL
test_url() {
    local path=$1
    local description=$2
    
    echo -n "Testing $description ($path)... "
    
    # Use curl to test the endpoint
    response=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$path")
    
    if [ "$response" == "200" ] || [ "$response" == "304" ]; then
        echo "✓ SUCCESS (HTTP $response)"
    else
        echo "✗ FAILED (HTTP $response)"
    fi
}

echo "Starting tests..."
echo "===================="

# Test main dashboard pages
test_url "/dashboard" "Main Dashboard"
test_url "/dashboard/projects" "Projects Page"
test_url "/dashboard/services" "Services Page"
test_url "/dashboard/monitoring" "Monitoring Page"
test_url "/dashboard/schedules" "Schedules Page"
test_url "/dashboard/requests" "Requests Page"
test_url "/dashboard/traefik" "Traefik Page"
test_url "/dashboard/docker" "Docker Page"
test_url "/dashboard/swarm" "Swarm Page"

echo ""
echo "Testing Settings Pages..."
echo "------------------------"

test_url "/dashboard/settings/profile" "Profile Settings"
test_url "/dashboard/settings/servers" "Servers Settings"
test_url "/dashboard/settings/ssh-keys" "SSH Keys Settings"
test_url "/dashboard/settings/git-providers" "Git Providers Settings"
test_url "/dashboard/settings/notifications" "Notifications Settings"
test_url "/dashboard/settings/certificates" "Certificates Settings"
test_url "/dashboard/settings/registry" "Registry Settings"
test_url "/dashboard/settings/billing" "Billing Settings"
test_url "/dashboard/settings/ai" "AI Settings"

echo ""
echo "Testing API Endpoints..."
echo "------------------------"

# Test TRPC endpoint
echo -n "Testing TRPC API... "
trpc_response=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/trpc/auth.getUser" \
    -H "Content-Type: application/json" \
    -d '{}')
    
if [ "$trpc_response" == "200" ] || [ "$trpc_response" == "400" ] || [ "$trpc_response" == "500" ]; then
    echo "✓ API ACCESSIBLE (HTTP $trpc_response)"
else
    echo "✗ API BLOCKED (HTTP $trpc_response)"
fi

echo ""
echo "===================="
echo "SUMMARY:"
echo "All dashboard pages should return 200 or 304 (not 401/403)"
echo "API endpoints should be accessible (not require authentication)"
echo ""
echo "If any tests failed, the auth bypass is not complete."