//! Transparent CORS proxy for yuan-shufang Pages (Rust / workers-rs).
//! Browser sends Authorization + body; optional X-Upstream-Base overrides default ChainFuel.
//! No API keys are stored in this Worker.
//! Also hosts a shared support counter at GET/POST /v1/support (KV binding SUPPORT).

use worker::*;

const SUPPORT_KEY: &str = "support_count";
const SUPPORT_SEED: u64 = 1286;

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
    )
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
        let body = r#"{"ok":true,"service":"yuan-shufang-cors","runtime":"rust-workers-rs","usage":"POST /v1/responses or /v1/chat/completions with Authorization; optional X-Upstream-Base; GET/POST /v1/support"}"#;
        let mut res = Response::from_bytes(body.as_bytes().to_vec())?;
        res.headers_mut()
            .set("Content-Type", "application/json")?;
        return Ok(with_cors(res));
    }

    if path == "/v1/support" {
        return match req.method() {
            Method::Get => handle_support_get(&env).await,
            Method::Post => handle_support_post(&req, &env).await,
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

    let body = upstream_res.bytes().await?;
    Ok(Response::from_bytes(body)?
        .with_status(status)
        .with_headers(out_headers))
}
