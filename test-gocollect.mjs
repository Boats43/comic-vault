// GoCollect API connectivity test

const GOCOLLECT_BASE = "https://api.gocollect.com/api/v2";

async function testGoCollect() {
  const apiKey = process.env.GOCOLLECT_API;
  
  console.log('\n=== GOCOLLECT API DIAGNOSTIC ===\n');
  console.log('Environment check:');
  console.log(`  GOCOLLECT_API present: ${apiKey ? 'YES' : 'NO'}`);
  if (apiKey) {
    console.log(`  Token length: ${apiKey.length} characters`);
    console.log(`  Token preview: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`);
  }
  
  if (!apiKey) {
    console.log('\n❌ No API token found in environment');
    console.log('   Set GOCOLLECT_API to test connectivity');
    return;
  }
  
  console.log('\nEndpoint configuration:');
  console.log(`  Base URL: ${GOCOLLECT_BASE}`);
  console.log('  Auth method: Query parameter (api_key=...)');
  console.log('  Headers: Accept: application/json');
  
  console.log('\nTest request:');
  const title = 'Amazing Adventures';
  const issue = '5';
  const year = 1961;
  const publisher = 'Marvel';
  
  const seriesName = String(title).replace(/#\s*\d+/, "").trim();
  const query = encodeURIComponent(`${seriesName} ${issue}`);
  const url = `${GOCOLLECT_BASE}/search?q=${query}&type=comic&api_key=${encodeURIComponent(apiKey)}`;
  
  console.log(`  Title: ${title} #${issue} (${year}) ${publisher}`);
  console.log(`  Query string: "${seriesName} ${issue}"`);
  console.log(`  Full URL: ${GOCOLLECT_BASE}/search?q=${query}&type=comic&api_key=[REDACTED]`);
  
  console.log('\nSending request...\n');
  
  try {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s for diagnostic
    
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const elapsed = Date.now() - startTime;
    
    console.log('Response received:');
    console.log(`  HTTP Status: ${res.status} ${res.statusText}`);
    console.log(`  Response time: ${elapsed}ms`);
    console.log(`  Content-Type: ${res.headers.get('content-type')}`);
    
    let body;
    const contentType = res.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      body = await res.json();
      console.log('\nResponse body (JSON):');
      console.log(JSON.stringify(body, null, 2));
      
      if (Array.isArray(body?.results)) {
        console.log(`\n✅ API reachable: ${body.results.length} result(s) returned`);
        if (body.results.length > 0) {
          const first = body.results[0];
          console.log(`   First result: ${first.title || '?'} #${first.issue_number || '?'}`);
        }
      } else {
        console.log('\n⚠️  API responded but unexpected format');
      }
    } else {
      body = await res.text();
      console.log('\nResponse body (text):');
      console.log(body.substring(0, 500));
    }
    
    if (res.status === 401 || res.status === 403) {
      console.log('\n❌ Authentication failed - token may be invalid or expired');
    } else if (res.status === 522) {
      console.log('\n❌ HTTP 522 - Connection timeout (origin unreachable)');
    } else if (res.status >= 500) {
      console.log('\n❌ Server error - GoCollect service may be down');
    } else if (res.status >= 400) {
      console.log('\n❌ Client error - check request format');
    }
    
  } catch (err) {
    console.log('Request failed:');
    if (err.name === 'AbortError') {
      console.log('  ❌ Timeout after 5s - endpoint unreachable');
    } else {
      console.log(`  ❌ Error: ${err.message}`);
      console.log(`  Error type: ${err.name}`);
    }
  }
  
  console.log('\n=== END DIAGNOSTIC ===\n');
}

testGoCollect().catch(console.error);
