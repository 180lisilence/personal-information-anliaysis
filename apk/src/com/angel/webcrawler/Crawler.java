package com.angel.webcrawler;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 网页抓取与正文提取。逻辑与桌面版 crawl.py 对齐：
 * 伪装 UA、编码兜底（header / meta / GBK 回退）、噪声标签剔除、标题与列表结构保留。
 */
public class Crawler {

    public static class Page {
        public String title = "";
        public String description = "";
        public String body = "";
        public String finalUrl = "";
        public int status = 0;
        public List<String[]> links = new ArrayList<String[]>();
        public List<String> images = new ArrayList<String>();
    }

    private static final String UA =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

    /** 正文提取时剔除的噪声标签（连同内容） */
    private static final String[] NOISE = {
            "script", "style", "noscript", "svg", "canvas", "iframe",
            "template", "nav", "header", "footer", "aside", "form",
            "button", "select", "option",
    };

    public static String now() {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.CHINA).format(new Date());
    }

    /** 时间戳，精确到秒 */
    public static String timestamp() {
        return new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.CHINA).format(new Date());
    }

    // ---------------------------------------------------------------- URL

    public static String normalizeUrl(String raw) {
        if (raw == null) return "";
        String s = raw.trim();
        if (s.length() > 1 && (s.charAt(0) == '"' || s.charAt(0) == '\'')) {
            s = s.substring(1, s.length() - (s.charAt(s.length() - 1) == s.charAt(0) ? 1 : 0));
        }
        if (s.isEmpty()) return "";
        if (!s.matches("(?i)^https?://.*")) s = "https://" + s.replaceAll("^/+", "");
        return s;
    }

    /** 支持空格 / 逗号 / 分号 / 换行分隔的多个网址 */
    public static List<String> splitUrls(String text) {
        List<String> out = new ArrayList<String>();
        if (text == null) return out;
        for (String part : text.split("[\\s,;，；]+")) {
            String u = normalizeUrl(part);
            if (!u.isEmpty() && !out.contains(u)) out.add(u);
        }
        return out;
    }

    private static String absolute(String base, String href) {
        try {
            return new URI(base).resolve(href).toString();
        } catch (Exception e) {
            return href;
        }
    }

    // --------------------------------------------------------------- HTTP

    public static Page fetch(String url, int timeoutMs) throws IOException {
        IOException last = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(timeoutMs);
                conn.setReadTimeout(timeoutMs);
                conn.setRequestProperty("User-Agent", UA);
                conn.setRequestProperty("Accept",
                        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
                conn.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");
                conn.setRequestProperty("Accept-Encoding", "identity");

                int code = conn.getResponseCode();
                InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
                if (is == null) throw new IOException("HTTP " + code + "，响应体为空");
                byte[] raw = readAll(is);
                is.close();

                Page p = parse(decode(raw, conn.getContentType()), conn.getURL().toString());
                p.status = code;
                return p;
            } catch (IOException e) {
                last = e;
                if (attempt < 2) {
                    try {
                        Thread.sleep(900L * (attempt + 1));
                    } catch (InterruptedException ignored) {
                        Thread.currentThread().interrupt();
                    }
                }
            } finally {
                if (conn != null) conn.disconnect();
            }
        }
        throw last != null ? last : new IOException("请求失败");
    }

    private static byte[] readAll(InputStream is) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
        return bos.toByteArray();
    }

    /** 编码兜底：HTTP 头 -> 页面 meta -> UTF-8（乱码则回退 GBK） */
    public static String decode(byte[] raw, String contentType) {
        String cs = null;
        if (contentType != null) {
            Matcher m = Pattern.compile("charset=\\s*[\"']?([\\w\\-]+)", Pattern.CASE_INSENSITIVE)
                    .matcher(contentType);
            if (m.find()) cs = m.group(1);
        }
        if (cs == null && raw.length > 0) {
            int head = Math.min(raw.length, 4096);
            String probe = new String(raw, 0, head, StandardCharsets.ISO_8859_1);
            Matcher m = Pattern.compile("charset=\\s*[\"']?([\\w\\-]+)", Pattern.CASE_INSENSITIVE)
                    .matcher(probe);
            if (m.find()) cs = m.group(1);
        }
        if (cs != null) {
            try {
                return new String(raw, Charset.forName(cs));
            } catch (Exception ignored) {
                // 未知 charset，走下面的兜底
            }
        }
        String utf8 = new String(raw, StandardCharsets.UTF_8);
        int bad = 0;
        for (int i = 0; i < utf8.length(); i++) if (utf8.charAt(i) == '\uFFFD') bad++;
        if (utf8.length() > 0 && bad > utf8.length() / 100) {
            try {
                return new String(raw, Charset.forName("GBK"));
            } catch (Exception ignored) {
            }
        }
        return utf8;
    }

    // -------------------------------------------------------------- PARSE

    private static String firstGroup(String src, String regex) {
        Matcher m = Pattern.compile(regex).matcher(src);
        return m.find() ? m.group(1) : "";
    }

    public static Page parse(String html, String baseUrl) {
        Page p = new Page();
        p.finalUrl = baseUrl;

        p.title = cleanText(unescape(firstGroup(html, "(?is)<title[^>]*>(.*?)</title>")));

        Matcher md = Pattern.compile(
                "(?is)<meta[^>]+(?:name|property)\\s*=\\s*[\"'](?:description|og:description)[\"'][^>]*>")
                .matcher(html);
        if (md.find()) {
            Matcher mc = Pattern.compile("(?i)content\\s*=\\s*[\"']([^\"']*)[\"']").matcher(md.group());
            if (mc.find()) p.description = cleanText(unescape(mc.group(1)));
        }

        // 先剔除噪声标签，再提取链接：避免把导航/页脚链接混进正文链接列表
        String clean = html;
        for (String tag : NOISE) {
            clean = clean.replaceAll("(?is)<" + tag + "\\b[^>]*>.*?</" + tag + "\\s*>", " ");
            clean = clean.replaceAll("(?is)<" + tag + "\\b[^>]*/?>", " ");
        }

        Matcher ma = Pattern.compile("(?is)<a\\s+[^>]*href\\s*=\\s*[\"']([^\"']+)[\"'][^>]*>(.*?)</a>")
                .matcher(clean);
        while (ma.find()) {
            String href = ma.group(1).trim();
            if (href.isEmpty() || href.startsWith("#") || href.startsWith("javascript:")
                    || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
            String text = cleanText(unescape(stripTags(ma.group(2))));
            p.links.add(new String[]{text.isEmpty() ? href : text, absolute(baseUrl, href)});
        }

        Matcher mi = Pattern.compile("(?is)<img[^>]+src\\s*=\\s*[\"']([^\"']+)[\"']").matcher(clean);
        while (mi.find()) {
            String src = mi.group(1).trim();
            if (!src.isEmpty()) p.images.add(absolute(baseUrl, src));
        }

        Pattern block = Pattern.compile(
                "(?is)<(p|h[1-6]|li|td|th|blockquote|pre)\\b[^>]*>(.*?)</\\1\\s*>");
        Matcher mb = block.matcher(clean);
        StringBuilder sb = new StringBuilder();
        Set<String> seen = new HashSet<String>();
        boolean prevLi = false;
        while (mb.find()) {
            String tag = mb.group(1).toLowerCase(Locale.ROOT);
            String text = cleanText(unescape(stripTags(mb.group(2))));
            if (text.length() < 2 || !seen.add(text)) continue;
            boolean isLi = tag.equals("li");
            if (sb.length() > 0) {
                // 连续的列表项之间不加空行，其余块之间空一行
                sb.append(isLi && prevLi ? "\n" : "\n\n");
            }
            if (tag.startsWith("h")) {
                sb.append(repeat('#', tag.charAt(1) - '0')).append(' ');
            } else if (isLi) {
                sb.append("- ");
            }
            sb.append(text);
            prevLi = isLi;
        }
        p.body = sb.length() > 0 ? sb.toString().trim()
                : cleanText(unescape(stripTags(clean)));
        return p;
    }

    private static String repeat(char c, int n) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) sb.append(c);
        return sb.toString();
    }

    public static String stripTags(String s) {
        if (s == null) return "";
        return s.replaceAll("(?is)<[^>]*>", " ");
    }

    public static String cleanText(String s) {
        if (s == null) return "";
        s = s.replace('\u00a0', ' ').replace("\u200b", "");
        s = s.replaceAll("[ \\t\\x0B\\f\\r]+", " ");
        s = s.replaceAll("\\n\\s*\\n\\s*\\n+", "\n\n");
        return s.trim();
    }

    private static final String[][] ENTITIES = {
            {"&nbsp;", " "}, {"&amp;", "&"}, {"&lt;", "<"}, {"&gt;", ">"},
            {"&quot;", "\""}, {"&#39;", "'"}, {"&apos;", "'"}, {"&mdash;", "—"},
            {"&ndash;", "–"}, {"&hellip;", "…"}, {"&middot;", "·"}, {"&ldquo;", "“"},
            {"&rdquo;", "”"}, {"&lsquo;", "‘"}, {"&rsquo;", "’"},
    };

    public static String unescape(String s) {
        if (s == null) return "";
        String out = s;
        for (String[] e : ENTITIES) out = out.replace(e[0], e[1]);
        Matcher m = Pattern.compile("&#(x?)([0-9a-fA-F]+);").matcher(out);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            try {
                int cp = Integer.parseInt(m.group(2), m.group(1).isEmpty() ? 10 : 16);
                m.appendReplacement(sb, Matcher.quoteReplacement(new String(Character.toChars(cp))));
            } catch (Exception ex) {
                m.appendReplacement(sb, Matcher.quoteReplacement(m.group()));
            }
        }
        m.appendTail(sb);
        return sb.toString();
    }

    // ------------------------------------------------------------- OUTPUT

    /** 生成单个页面的 txt 内容（每个网址一个文件，不合并） */
    public static String buildText(Page p, String sourceUrl, int index, int total) {
        StringBuilder sb = new StringBuilder();
        sb.append(rep('=', 78)).append('\n');
        if (total > 1) sb.append("# 网页爬取结果   [").append(index).append('/').append(total).append("]\n");
        else sb.append("# 网页爬取结果\n");
        sb.append("# 源链接:    ").append(sourceUrl).append('\n');
        sb.append("# 最终链接:  ").append(p.finalUrl).append('\n');
        sb.append("# HTTP 状态: ").append(p.status).append('\n');
        sb.append("# 抓取时间:  ").append(now()).append('\n');
        sb.append(rep('=', 78)).append("\n\n");
        sb.append("标题: ").append(p.title.isEmpty() ? "(无)" : p.title).append('\n');
        if (!p.description.isEmpty()) sb.append("描述: ").append(p.description).append('\n');
        sb.append('\n');
        sb.append(p.body.isEmpty() ? "(未提取到正文，可能是纯 JS 渲染页面)" : p.body).append("\n\n");

        if (!p.links.isEmpty()) {
            sb.append(rep('-', 78)).append('\n');
            sb.append("链接 (").append(p.links.size()).append(" 条):\n");
            Set<String> seen = new HashSet<String>();
            int n = 0;
            for (String[] l : p.links) {
                if (!seen.add(l[1])) continue;
                n++;
                sb.append("  ").append(n).append(". ").append(l[0]).append('\n');
                sb.append("     ").append(l[1]).append('\n');
            }
            sb.append('\n');
        }
        return sb.toString();
    }

    private static String rep(char c, int n) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) sb.append(c);
        return sb.toString();
    }
}
