//! Transparent CORS proxy for yuan-shufang Pages (Rust / workers-rs).
//! Browser sends Authorization + body; optional X-Upstream-Base overrides default ChainFuel.
//! The browser LLM key is not stored here.
//! BCPM_API_KEY is a Worker secret for the paid formula lookup and is never returned.
//! Also hosts a shared support counter at GET/POST /v1/support (KV binding SUPPORT).

use worker::*;

const SUPPORT_KEY: &str = "support_count";
const SUPPORT_SEED: u64 = 1286;
const BCPM_BASE: &str = "https://srv-openapi.bcpmdata.com";
const BCPM_LIST: &str = "/pharma/general/v1/tcm_recipe/list";
const BCPM_DETAIL: &str = "/pharma/general/v1/tcm_recipe/detail";

fn cors_headers() -> Headers {
    let h = Headers::new();
    let _ = h.set("Access-Control-Allow-Origin", "*");
    let _ = h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    let _ = h.set(
        "Access-Control-Allow-Headers",
        "Authorization,Content-Type,X-Upstream-Base,X-Ysf-Base,X-Requested-With",
    );
    let _ = h.set("Access-Control-Max-Age", "86400");
    let _ = h.set("Access-Control-Expose-Headers", "Content-Type");
    h
}

fn with_cors(mut res: Response) -> Response {
    let headers = res.headers_mut();
    for (k, v) in [
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "GET,POST,OPTIONS"),
        (
            "Access-Control-Allow-Headers",
            "Authorization,Content-Type,X-Upstream-Base,X-Ysf-Base,X-Requested-With",
        ),
        ("Access-Control-Max-Age", "86400"),
        ("Access-Control-Expose-Headers", "Content-Type"),
    ] {
        let _ = headers.set(k, v);
    }
    res
}

fn json_error(status: u16, message: &str) -> Result<Response> {
    let body = format!(r#"{{"error":{{"message":{}}}}}"#, serde_json_str(message));
    let mut res = Response::from_bytes(body.into_bytes())?;
    res.headers_mut()
        .set("Content-Type", "application/json")?;
    Ok(with_cors(res.with_status(status)))
}

fn json_count(count: u64) -> Result<Response> {
    let body = format!(r#"{{"count":{count}}}"#);
    let mut res = Response::from_bytes(body.into_bytes())?;
    res.headers_mut()
        .set("Content-Type", "application/json")?;
    Ok(with_cors(res))
}

fn serde_json_str(s: &str) -> String {
    let mut out = String::from('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn is_hop(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailers"
            | "transfer-encoding"
            | "upgrade"
            | "host"
            | "content-length"
            | "cf-connecting-ip"
            | "cf-ipcountry"
            | "cf-ray"
            | "cf-visitor"
            | "x-forwarded-for"
            | "x-forwarded-proto"
            | "x-real-ip"
            | "accept-encoding"
            | "content-encoding"
    )
}

/// Ask upstream for an uncompressed body.
/// Guarantees: Accept-Encoding is identity.
/// Does not guarantee: upstream honors it.
fn request_plain_body(headers: &Headers) {
    let _ = headers.set("Accept-Encoding", "identity");
}

/// Keep the browser from waiting on a gzipped SSE body.
/// Guarantees: no content-encoding, no content-length, Cache-Control includes no-transform.
/// Does not guarantee: every edge obeys no-transform.
fn response_plain_stream(headers: &Headers) {
    let _ = headers.set("Cache-Control", "no-cache, no-transform");
    let _ = headers.set("X-Accel-Buffering", "no");
    let _ = headers.delete("content-encoding");
    let _ = headers.delete("content-length");
}

fn pick_upstream(req: &Request, env: &Env) -> std::result::Result<String, String> {
    let header = req
        .headers()
        .get("X-Upstream-Base")
        .ok()
        .flatten()
        .or_else(|| req.headers().get("X-Ysf-Base").ok().flatten())
        .unwrap_or_default();
    let default = env
        .var("DEFAULT_UPSTREAM")
        .map(|v| v.to_string())
        .unwrap_or_else(|_| "https://ca.chainfuel.tap365.org".to_string());
    let mut raw = if header.trim().is_empty() {
        default
    } else {
        header
    };
    raw = raw.trim().trim_end_matches('/').to_string();
    if raw.ends_with("/v1") {
        raw.truncate(raw.len() - 3);
        raw = raw.trim_end_matches('/').to_string();
    }
    let url = Url::parse(&raw).map_err(|_| "invalid X-Upstream-Base".to_string())?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err("upstream must be http(s)".into());
    }
    let mut base = format!("{}://{}", url.scheme(), url.host_str().unwrap_or(""));
    if let Some(port) = url.port() {
        base.push(':');
        base.push_str(&port.to_string());
    }
    let path = url.path().trim_end_matches('/');
    if !path.is_empty() && path != "/" {
        base.push_str(path);
    }
    Ok(base)
}

fn target_url(req: &Request, upstream_base: &str) -> Result<String> {
    let src = req.url()?;
    let path = src.path();
    let search = src.query().map(|q| format!("?{q}")).unwrap_or_default();
    Ok(format!(
        "{}{}{}",
        upstream_base.trim_end_matches('/'),
        path,
        search
    ))
}

async fn read_support_count(kv: &kv::KvStore) -> Result<u64> {
    match kv.get(SUPPORT_KEY).text().await? {
        Some(s) => Ok(s.trim().parse::<u64>().unwrap_or(SUPPORT_SEED).max(SUPPORT_SEED)),
        None => Ok(SUPPORT_SEED),
    }
}

async fn handle_support_get(env: &Env) -> Result<Response> {
    let kv = env.kv("SUPPORT")?;
    let count = read_support_count(&kv).await?;
    // Persist seed so first visitors see a stable shared baseline.
    if kv.get(SUPPORT_KEY).text().await?.is_none() {
        kv.put(SUPPORT_KEY, count.to_string())?.execute().await?;
    }
    json_count(count)
}

const COMMENTS_KEY: &str = "visitor_comments";
const COMMENT_CAP: usize = 40;

/// Fold a note so spaces and separators cannot hide a blocked word.
/// Guarantees: the result is lowercase and has no whitespace or separator marks.
/// Does not guarantee: every homoglyph is caught.
fn fold_comment(raw: &str) -> String {
    raw.chars()
        .filter(|c| {
            !c.is_whitespace()
                && !c.is_control()
                && !matches!(
                    *c,
                    '.' | '_' | '-' | '*' | '。' | '，' | ',' | '、' | '/' | '\\' | '|' | '+' | ':' | '：'
                )
        })
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Reject spam, sexual solicitation, and political agitation.
/// Guarantees: an empty string is not blocked; a listed phrase is blocked after folding.
/// Does not guarantee: paraphrases, pictures, or novel slang are caught. Medical body words are not on the list.
fn comment_blocked(raw: &str) -> bool {
    let folded = fold_comment(raw);
    if folded.is_empty() {
        return false;
    }
    const WORDS: &[&str] = &[
        "http", "https", "www", "加微信", "加vx", "加v信", "威信", "裸聊", "约炮", "黄片", "色情",
        "淫秽", "嫖娼", "做爱", "手淫", "口交", "肛交", "博彩", "网赌", "刷单", "代开发票", "办证",
        "六四", "天安门事件", "法轮", "台独", "港独", "藏独", "推翻政府", "游行示威",
    ];
    if WORDS.iter().any(|word| folded.contains(word)) {
        return true;
    }
    let digits = folded.chars().filter(|c| c.is_ascii_digit()).count();
    digits >= 11
}

/// Drop control characters and cap a visitor field by Unicode scalar count.
/// Guarantees: the result has no control chars and is at most `max_chars`.
/// Does not guarantee: the text is polite or unique.
fn clip_visitor(raw: &str, max_chars: usize) -> String {
    raw.chars()
        .filter(|c| !c.is_control())
        .take(max_chars)
        .collect::<String>()
        .trim()
        .to_string()
}

/// Read the shared comment list. A broken value is treated as empty.
/// Guarantees: returns a JSON array, never a non-array.
/// Does not guarantee: the list is complete if KV is stale.
async fn read_comments(kv: &kv::KvStore) -> Result<Vec<serde_json::Value>> {
    let raw = match kv.get(COMMENTS_KEY).text().await? {
        Some(s) => s,
        None => return Ok(Vec::new()),
    };
    match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(serde_json::Value::Array(items)) => Ok(items),
        _ => Ok(Vec::new()),
    }
}

fn comments_body(items: &[serde_json::Value]) -> Result<Response> {
    let body = serde_json::json!({ "comments": items });
    let mut res = Response::from_bytes(body.to_string().into_bytes())?;
    res.headers_mut()
        .set("Content-Type", "application/json")?;
    Ok(with_cors(res))
}

/// Return the stored visitor notes, newest last.
/// Guarantees: the body is `{comments: [...]}`.
/// Does not guarantee: another tab's just-posted note is already visible.
async fn handle_comments_get(env: &Env) -> Result<Response> {
    let kv = env.kv("SUPPORT")?;
    let items = read_comments(&kv).await?;
    comments_body(&items)
}

/// Append one note. Name defaults to 访客. Text must be 1 to 120 characters.
/// Guarantees: a stored note is capped, the list never grows past 40, and a blocked note is not stored.
/// Does not guarantee: the same person cannot post again, or that a reworded note is caught.
async fn handle_comments_post(mut req: Request, env: &Env) -> Result<Response> {
    let bytes = req.bytes().await?;
    let incoming: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    let name = clip_visitor(
        incoming.get("name").and_then(|v| v.as_str()).unwrap_or(""),
        16,
    );
    let text = clip_visitor(
        incoming.get("text").and_then(|v| v.as_str()).unwrap_or(""),
        120,
    );
    if text.chars().count() < 1 {
        return json_error(400, "评论不能为空");
    }
    if comment_blocked(&name) || comment_blocked(&text) {
        return json_error(400, "这句话不能留下");
    }
    let kv = env.kv("SUPPORT")?;
    let mut items = read_comments(&kv).await?;
    items.push(serde_json::json!({
        "name": if name.is_empty() { "访客".to_string() } else { name },
        "text": text,
        "at": Date::now().to_string(),
    }));
    if items.len() > COMMENT_CAP {
        let drop_n = items.len() - COMMENT_CAP;
        items.drain(0..drop_n);
    }
    kv.put(COMMENTS_KEY, serde_json::Value::Array(items.clone()).to_string())?
        .execute()
        .await?;
    comments_body(&items)
}

/// Increment the shared flower count once per POST.
/// Guarantees: a successful POST adds 1, including a repeat from the same browser or IP.
/// Does not guarantee: spam protection. There is no per-IP lock.
async fn handle_support_post(_req: &Request, env: &Env) -> Result<Response> {
    let kv = env.kv("SUPPORT")?;
    let count = read_support_count(&kv).await?;
    let next = count.saturating_add(1);
    kv.put(SUPPORT_KEY, next.to_string())?.execute().await?;
    json_count(next)
}

/**
 * Read the paid formula-library key.
 * Guarantees: empty, placeholder, and missing bindings return None.
 * Does not guarantee: the key is accepted by 摩熵.
 */
fn bcpm_key(env: &Env) -> Option<String> {
    let raw = env
        .secret("BCPM_API_KEY")
        .ok()
        .map(|s| s.to_string())
        .or_else(|| env.var("BCPM_API_KEY").ok().map(|v| v.to_string()))?;
    let key = raw.trim().to_string();
    // Reject whitespace so a bad secret cannot split the Authorization header.
    if key.is_empty()
        || key == "unset"
        || key == "your api key"
        || key.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        None
    } else {
        Some(key)
    }
}

/**
 * Keep a search string short enough for one paid call.
 * Guarantees: result is trimmed and at most 40 Unicode scalars.
 * Does not guarantee: the vendor will treat it as a symptom rather than a name.
 */
fn clip_query(q: &str) -> String {
    q.trim().chars().take(40).collect()
}

/**
 * Pick the vendor field. Only a short name-like string uses 方名.
 * Guarantees: a sentence such as「不能喝冷饮」stays on 功用主治.
 * Does not guarantee: every real formula name is at most 8 characters.
 */
fn bcpm_search_field(q: &str) -> &'static str {
    const SUFFIX: [&str; 6] = ["汤", "散", "丸", "饮", "膏", "丹"];
    let n = q.chars().count();
    let name_like = (2..=8).contains(&n)
        && SUFFIX.iter().any(|s| q.ends_with(s))
        && !q.chars().any(|c| "不吗怎？?，,。！!".contains(c));
    if name_like {
        "recipe_name"
    } else {
        "function"
    }
}

/**
 * Keep a dose string whole. Cut only on a separator, then mark the omission.
 * Guarantees: a returned composition does not end in the middle of a number.
 * Does not guarantee: the omitted tail is unimportant.
 */
fn clip_at_sep(raw: &str, max_chars: usize) -> String {
    let t = raw.trim();
    if t.chars().count() <= max_chars {
        return t.to_string();
    }
    let cut: String = t.chars().take(max_chars).collect();
    match cut.rfind(|c: char| "、，,；; ".contains(c)) {
        Some(idx) => format!("{}…（已截断，未列全）", cut[..idx].trim_end()),
        None => "…（过长已省略，不得据残段开药）".to_string(),
    }
}

/**
 * Copy one upstream string and cap it so a consult cannot swallow the model context.
 * Guarantees: at most `max_chars` Unicode scalars, no panic on missing keys.
 * Does not guarantee: the vendor field is complete after the cap.
 */
fn clip_field(v: &serde_json::Value, key: &str, max_chars: usize) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .chars()
        .take(max_chars)
        .collect()
}

/**
 * POST one 摩熵 JSON method. The key stays in the Authorization header.
 * Guarantees: the key is not included in the returned error text.
 * Does not guarantee: HTTP 200 means business success; callers must read `code`.
 */
async fn bcpm_post(path: &str, key: &str, body: serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let headers = Headers::new();
    headers
        .set("Content-Type", "application/json")
        .map_err(|e| e.to_string())?;
    headers
        .set("Authorization", key)
        .map_err(|e| e.to_string())?;
    let mut init = RequestInit::new();
    init.with_method(Method::Post);
    init.with_headers(headers);
    let bytes = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
    init.with_body(Some(bytes.into()));
    let url = format!("{BCPM_BASE}{path}");
    let upstream_req = Request::new_with_init(&url, &init).map_err(|e| e.to_string())?;
    let mut res = Fetch::Request(upstream_req)
        .send()
        .await
        .map_err(|e| format!("bcpm fetch failed: {e}"))?;
    let status = res.status_code();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if status != 200 {
        return Err(format!("bcpm http {status}"));
    }
    serde_json::from_str(&text).map_err(|_| "bcpm returned non-json".to_string())
}

/**
 * Turn one list or detail object into the fields the model is allowed to cite.
 * Guarantees: only name, source, composition, usage, function, indications, cautions, add/subtract.
 * Does not guarantee: every field is present in the vendor record.
 */
fn cite_recipe(v: &serde_json::Value, id: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "name": clip_field(v, "recipe_name", 80),
        "reference": clip_field(v, "recipe_reference", 120),
        "class": clip_field(v, "recipe_class", 80),
        "composition": clip_at_sep(&clip_field(v, "recipe_composition", 2000), 400),
        "usage": clip_at_sep(&clip_field(v, "usage_dosage", 2000), 240),
        "function": clip_field(v, "function", 240),
        "indications": clip_field(v, "indications", 400),
        "cautions": clip_field(v, "cautions", 200),
        "add_subtract": clip_field(v, "add_subtract", 240),
    })
}

/**
 * Search the paid formula library once, then fetch detail for the first hit only.
 * Guarantees: at most two upstream calls; empty key returns 503 and does not call upstream.
 * Does not guarantee: the first hit matches the complaint. The model must reject a bad hit.
 * Stops when the list is empty, detail fails, or the two-call budget is spent.
 */
/**
 * Reserve two upstream slots before calling the paid library.
 * Guarantees: a KV failure or a cap hit does not call 摩熵.
 * Does not guarantee: two isolates incrementing the same second stay under the cap.
 * Caps: 80 upstream calls per UTC day for everyone, 6 per IP. Each consult takes 2.
 */
async fn reserve_bcpm(env: &Env, req: &Request) -> Result<bool> {
    let kv = env.kv("SUPPORT")?;
    if kv.get("bcpm:fuse").text().await?.is_some() {
        return Ok(false);
    }
    let day = Date::now().as_millis() / 86_400_000;
    let ip = req
        .headers()
        .get("CF-Connecting-IP")
        .ok()
        .flatten()
        .unwrap_or_else(|| "unknown".to_string());
    let ip_key: String = ip
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == ':')
        .take(64)
        .collect();
    let gkey = format!("bcpm:g:{day}");
    let ikey = format!("bcpm:i:{day}:{ip_key}");
    let g = kv
        .get(&gkey)
        .text()
        .await?
        .unwrap_or_default()
        .parse::<u64>()
        .unwrap_or(0);
    let i = kv
        .get(&ikey)
        .text()
        .await?
        .unwrap_or_default()
        .parse::<u64>()
        .unwrap_or(0);
    if g + 2 > 80 || i + 2 > 6 {
        return Ok(false);
    }
    kv.put(&gkey, (g + 2).to_string())?
        .expiration_ttl(172_800)
        .execute()
        .await?;
    kv.put(&ikey, (i + 2).to_string())?
        .expiration_ttl(172_800)
        .execute()
        .await?;
    Ok(true)
}

/**
 * A hit must share a 2-character slice with the query, or it is not citable.
 * Guarantees: an ignored vendor filter cannot pass the first page through unchanged
 * unless that page actually contains the query text.
 * Does not guarantee: a shared slice means the formula treats this complaint.
 */
fn cites_query(q: &str, hit: &serde_json::Value) -> bool {
    let blob = format!(
        "{}{}{}{}",
        hit.get("name").and_then(|v| v.as_str()).unwrap_or(""),
        hit.get("function").and_then(|v| v.as_str()).unwrap_or(""),
        hit.get("indications").and_then(|v| v.as_str()).unwrap_or(""),
        hit.get("composition").and_then(|v| v.as_str()).unwrap_or("")
    );
    let chars: Vec<char> = q.chars().filter(|c| !c.is_whitespace()).collect();
    chars.windows(2).any(|w| {
        let gram: String = w.iter().collect();
        blob.contains(&gram)
    })
}

/**
 * Detail ids are copied into JSON, not headers. Still reject odd characters.
 * Guarantees: only ASCII id tokens are sent upstream.
 * Does not guarantee: the vendor id alphabet never grows past this set.
 */
fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/**
 * Stop calling 摩熵 for ten minutes after the vendor says the quota is gone.
 * Does not guarantee: the vendor resets on the same clock.
 */
async fn trip_bcpm_fuse(env: &Env) {
    let Ok(kv) = env.kv("SUPPORT") else {
        return;
    };
    let Ok(put) = kv.put("bcpm:fuse", "1") else {
        return;
    };
    let _ = put.expiration_ttl(600).execute().await;
}

/**
 * Search the paid formula library once, then fetch one detail.
 * Guarantees: missing key, KV failure, or cap hit does not call 摩熵;
 * a hit without composition or without the query text is dropped.
 * Does not guarantee: the remaining hit treats this complaint.
 * Stops after list plus at most one detail.
 */
async fn handle_external_formulas(mut req: Request, env: &Env) -> Result<Response> {
    let bytes = req.bytes().await?;
    let incoming: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    let raw_q = incoming.get("q").and_then(|v| v.as_str()).unwrap_or("");
    let cleaned: String = raw_q.chars().filter(|c| !c.is_control()).collect();
    let q = clip_query(&cleaned);
    if q.chars().count() < 2 {
        return json_error(400, "q 至少 2 个字");
    }
    let key = match bcpm_key(env) {
        Some(k) => k,
        None => {
            return json_error(503, "库外方剂接口未接通");
        }
    };
    match reserve_bcpm(env, &req).await {
        Ok(true) => {}
        Ok(false) => return json_error(429, "库外方剂额度已用完"),
        Err(_) => return json_error(503, "库外方剂额度暂时无法确认"),
    }
    let field = bcpm_search_field(&q);
    let list_body = serde_json::json!({
        "page": 1,
        "search": { field: q }
    });
    let listed = match bcpm_post(BCPM_LIST, &key, list_body).await {
        Ok(v) => v,
        Err(_) => return json_error(502, "库外方剂接口暂时不可用"),
    };
    let code = listed.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
    if code == 10403 {
        return json_error(502, "库外方剂接口未接通");
    }
    if code == 10429 {
        trip_bcpm_fuse(env).await;
        return json_error(429, "库外方剂额度已用完");
    }
    if code != 10200 {
        return json_error(502, "库外方剂接口没有返回成功");
    }
    let empty = Vec::new();
    let rows = listed
        .get("data")
        .and_then(|d| d.get("list"))
        .and_then(|l| l.as_array())
        .unwrap_or(&empty);
    let mut hits = Vec::new();
    // The reserve paid for one detail. Do not walk the list and spend more calls.
    if let Some(row) = rows.iter().find(|row| {
        safe_id(row.get("id").and_then(|v| v.as_str()).unwrap_or("").trim())
    }) {
        let id = row.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
        if let Ok(detail) = bcpm_post(BCPM_DETAIL, &key, serde_json::json!({ "id": id })).await {
            let detail_code = detail.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
            if detail_code == 10429 {
                trip_bcpm_fuse(env).await;
            } else if detail_code == 10200 {
                let data = detail.get("data").cloned().unwrap_or(serde_json::Value::Null);
                let merged = if data.get("recipe_name").is_some() {
                    data
                } else {
                    row.clone()
                };
                let hit = cite_recipe(&merged, id);
                let composition = hit.get("composition").and_then(|v| v.as_str()).unwrap_or("");
                // Empty or truncated-away composition is not citable. A hit that does not
                // contain the query is treated as a filter miss, not as a formula.
                if !composition.is_empty()
                    && !composition.starts_with('…')
                    && cites_query(&q, &hit)
                {
                    hits.push(hit);
                }
            }
        }
    }
    let body = serde_json::json!({
        "ok": true,
        "source": "摩熵数科中医药方剂",
        "source_url": "https://open.bcpmdata.com/api/163.html",
        "query": q,
        "field": field,
        "hits": hits
    });
    let mut res = Response::from_bytes(body.to_string().into_bytes())?;
    res.headers_mut()
        .set("Content-Type", "application/json")?;
    Ok(with_cors(res))
}

#[event(fetch)]
async fn fetch(mut req: Request, env: Env, _ctx: Context) -> Result<Response> {
    console_error_panic_hook::set_once();

    if req.method() == Method::Options {
        return Ok(Response::empty()?
            .with_status(204)
            .with_headers(cors_headers()));
    }

    let path = req.url()?.path().to_string();
    if req.method() == Method::Get && path == "/" {
        let body = r#"{"ok":true,"service":"yuan-shufang-cors","runtime":"rust-workers-rs","usage":"POST /v1/responses or /v1/chat/completions with Authorization; optional X-Upstream-Base; GET/POST /v1/support; GET/POST /v1/comments; POST /v1/formulas/external"}"#;
        let mut res = Response::from_bytes(body.as_bytes().to_vec())?;
        res.headers_mut()
            .set("Content-Type", "application/json")?;
        return Ok(with_cors(res));
    }

    if req.method() == Method::Post && path == "/v1/formulas/external" {
        return handle_external_formulas(req, &env).await;
    }

    if path == "/v1/support" {
        return match req.method() {
            Method::Get => handle_support_get(&env).await,
            Method::Post => handle_support_post(&req, &env).await,
            _ => json_error(405, "Method Not Allowed"),
        };
    }

    if path == "/v1/comments" {
        return match req.method() {
            Method::Get => handle_comments_get(&env).await,
            Method::Post => handle_comments_post(req, &env).await,
            _ => json_error(405, "Method Not Allowed"),
        };
    }

    if req.method() != Method::Post && req.method() != Method::Get {
        return json_error(405, "Method Not Allowed");
    }

    let upstream_base = match pick_upstream(&req, &env) {
        Ok(u) => u,
        Err(e) => return json_error(400, &e),
    };
    let url = target_url(&req, &upstream_base)?;

    let headers = Headers::new();
    for (k, v) in req.headers().entries() {
        let lk = k.to_ascii_lowercase();
        if is_hop(&lk) {
            continue;
        }
        if lk.starts_with("x-upstream") || lk == "x-ysf-base" {
            continue;
        }
        let _ = headers.set(&k, &v);
    }
    // Browser gzip makes SSE sit until the whole answer exists. Ask for plain text.
    request_plain_body(&headers);

    let method = req.method();
    let mut init = RequestInit::new();
    init.with_method(method.clone());
    init.with_headers(headers);

    if method != Method::Get && method != Method::Head {
        let bytes = req.bytes().await?;
        init.with_body(Some(bytes.into()));
    }

    let upstream_req = Request::new_with_init(&url, &init)?;
    let mut upstream_res = match Fetch::Request(upstream_req).send().await {
        Ok(r) => r,
        Err(e) => {
            return json_error(502, &format!("upstream fetch failed: {e}"));
        }
    };

    let status = upstream_res.status_code();
    let out_headers = Headers::new();
    for (k, v) in upstream_res.headers().entries() {
        if is_hop(&k) {
            continue;
        }
        let _ = out_headers.set(&k, &v);
    }
    for (k, v) in cors_headers().entries() {
        let _ = out_headers.set(&k, &v);
    }
    response_plain_stream(&out_headers);

    // Pass the body through. Buffering here is what made the browser wait
    // until the model finished before the first token could render.
    match upstream_res.stream() {
        Ok(stream) => Ok(Response::from_stream(stream)?
            .with_status(status)
            .with_headers(out_headers)),
        Err(_) => {
            let body = upstream_res.bytes().await?;
            Ok(Response::from_bytes(body)?
                .with_status(status)
                .with_headers(out_headers))
        }
    }
}

#[cfg(test)]
mod comment_filter_tests {
    use super::comment_blocked;

    #[test]
    fn keeps_ordinary_notes() {
        assert!(!comment_blocked("老师走好"));
        assert!(!comment_blocked("你好"));
        assert!(!comment_blocked("猴子"));
    }

    #[test]
    fn blocks_spam_sexual_and_political() {
        assert!(comment_blocked("加微.信 abc"));
        assert!(comment_blocked("来看黄片"));
        assert!(comment_blocked("台独宣传"));
        assert!(comment_blocked("电话 13800138000"));
    }
}
