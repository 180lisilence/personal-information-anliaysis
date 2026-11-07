package com.angel.webcrawler;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 网页爬取 · Android 版
 * 输入链接 -> 抓取 -> 每个链接单独一个 txt，保存到「下载/WebCrawler」。
 * 输入框的长按菜单（粘贴/全选）由系统提供。
 */
public class MainActivity extends Activity {

    private static final int REQ_TREE = 1001;

    // 深色配色，与桌面版一致
    private static final int BG = Color.parseColor("#1E1E1E");
    private static final int BG2 = Color.parseColor("#252526");
    private static final int BG3 = Color.parseColor("#2D2D2D");
    private static final int FG = Color.parseColor("#E6E6E6");
    private static final int FG2 = Color.parseColor("#9A9A9A");
    private static final int ACC = Color.parseColor("#0D6EFD");
    private static final int OK = Color.parseColor("#2EA043");
    private static final int ERR = Color.parseColor("#F85149");

    private EditText urlInput;
    private EditText nameInput;
    private TextView dirLabel;
    private TextView statusLabel;
    private TextView sizeLabel;
    private Button startBtn;

    private Uri treeUri;                    // 用户通过「选择输出目录」指定的目录
    private final List<Uri> lastFiles = new ArrayList<Uri>();
    private final ExecutorService pool = Executors.newSingleThreadExecutor();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile boolean busy = false;

    // ------------------------------------------------------------ 生命周期

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildUi();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        pool.shutdownNow();
    }

    // ------------------------------------------------------------------ UI

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v,
                getResources().getDisplayMetrics());
    }

    private TextView text(String s, float sizeSp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sizeSp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private LinearLayout.LayoutParams lp(int w, int h, int topMarginDp) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(w, h);
        p.topMargin = dp(topMarginDp);
        return p;
    }

    private Button button(String label) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(15f);
        b.setTextColor(Color.WHITE);
        b.setBackgroundTintList(ColorStateList.valueOf(ACC));
        b.setPadding(dp(12), dp(10), dp(12), dp(10));
        return b;
    }

    private EditText input(String hint, int minLines, int inputType) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setHintTextColor(FG2);
        e.setTextColor(FG);
        e.setTextSize(14f);
        e.setBackgroundColor(BG3);
        e.setPadding(dp(12), dp(10), dp(12), dp(10));
        e.setMinLines(minLines);
        e.setInputType(inputType);
        return e;
    }

    private void buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(BG);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.setPadding(dp(16), dp(18), dp(16), dp(24));
        scroll.addView(root, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // 标题
        TextView t = text("网页爬取工具", 20f, FG, true);
        root.addView(t);

        // ① 链接
        root.addView(text("① 链接（可输入多个，空格/逗号/换行分隔）", 13f, FG2, false), lp(-1, -2, 16));
        urlInput = input("https://example.com  https://example.org", 3,
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE
                        | InputType.TYPE_TEXT_VARIATION_URI);
        root.addView(urlInput, lp(-1, -2, 6));

        // ② 命名
        root.addView(text("② 命名（留空 = 时间戳，精确到秒）", 13f, FG2, false), lp(-1, -2, 14));
        nameInput = input("留空则用 YYYYMMDD_HHMMSS", 1, InputType.TYPE_CLASS_TEXT);
        root.addView(nameInput, lp(-1, -2, 6));

        // ③ 输出目录
        dirLabel = text("③ 输出目录： 下载/WebCrawler", 13f, FG2, false);
        root.addView(dirLabel, lp(-1, -2, 14));

        // ⑤ 选择输出目录
        Button pick = button("⑤ 选择输出目录（可选）");
        pick.setBackgroundTintList(ColorStateList.valueOf(BG3));
        pick.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                pickDir();
            }
        });
        root.addView(pick, lp(-1, -2, 8));

        // 开始抓取
        startBtn = button("开始抓取");
        startBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startCrawl();
            }
        });
        root.addView(startBtn, lp(-1, -2, 14));

        // 状态
        statusLabel = text("就绪", 13f, FG2, false);
        root.addView(statusLabel, lp(-1, -2, 12));

        // ④ 文件大小
        LinearLayout sizeBox = new LinearLayout(this);
        sizeBox.setOrientation(LinearLayout.HORIZONTAL);
        sizeBox.setGravity(Gravity.CENTER_VERTICAL);
        sizeBox.setBackgroundColor(BG2);
        sizeBox.setPadding(dp(14), dp(12), dp(14), dp(12));
        sizeBox.addView(text("④ 文件大小：", 14f, FG2, false));
        sizeLabel = text("—", 18f, OK, true);
        sizeBox.addView(sizeLabel);
        root.addView(sizeBox, lp(-1, -2, 14));

        // ⑥ 打开输出目录 / 查看文件
        Button open = button("⑥ 打开输出目录（查看生成的文件）");
        open.setBackgroundTintList(ColorStateList.valueOf(BG3));
        open.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showFiles();
            }
        });
        root.addView(open, lp(-1, -2, 12));

        TextView tip = text("提示：输入框长按可粘贴/全选；结果保存在系统「下载」目录下的 WebCrawler 文件夹。",
                12f, FG2, false);
        root.addView(tip, lp(-1, -2, 16));

        setContentView(scroll);
    }

    // -------------------------------------------------------------- 交互

    private void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_SHORT).show();
    }

    private void status(final String s) {
        ui.post(new Runnable() {
            @Override
            public void run() {
                statusLabel.setText(s);
            }
        });
    }

    private void pickDir() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try {
            startActivityForResult(i, REQ_TREE);
        } catch (Exception e) {
            toast("本机没有可用的目录选择器");
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_TREE && res == RESULT_OK && data != null && data.getData() != null) {
            treeUri = data.getData();
            try {
                getContentResolver().takePersistableUriPermission(treeUri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception ignored) {
            }
            dirLabel.setText("③ 输出目录： " + displayName(treeUri) + "（自定义）");
            toast("已切换输出目录");
        }
    }

    // -------------------------------------------------------------- 抓取

    private static String pad2(int n) {
        return n < 10 ? "0" + n : String.valueOf(n);
    }

    private static String shorten(String s) {
        if (s == null || s.isEmpty()) return "(无标题)";
        return s.length() > 26 ? s.substring(0, 26) + "…" : s;
    }

    private static String humanSize(double n) {
        String[] units = {"B", "KB", "MB", "GB"};
        int u = 0;
        while (n >= 1024 && u < units.length - 1) {
            n /= 1024;
            u++;
        }
        return u == 0 ? ((long) n) + " B" : String.format(Locale.US, "%.2f %s", n, units[u]);
    }

    private void startCrawl() {
        if (busy) return;
        final List<String> urls = Crawler.splitUrls(urlInput.getText().toString());
        if (urls.isEmpty()) {
            toast("请先输入网址");
            return;
        }
        String name = nameInput.getText().toString().trim();
        if (name.toLowerCase(Locale.ROOT).endsWith(".txt")) {
            name = name.substring(0, name.length() - 4);
        }
        if (name.isEmpty()) name = Crawler.timestamp();   // 时间戳，精确到秒

        final String baseName = name;
        final boolean multi = urls.size() > 1;
        final Uri tree = treeUri;

        busy = true;
        startBtn.setEnabled(false);
        startBtn.setText("抓取中…");
        sizeLabel.setText("—");
        sizeLabel.setTextColor(OK);
        lastFiles.clear();
        status("开始抓取 " + urls.size() + " 个网址，每个网址单独生成一个 txt …");

        pool.execute(new Runnable() {
            @Override
            public void run() {
                int ok = 0, failed = 0;
                long total = 0;
                List<Uri> made = new ArrayList<Uri>();
                for (int i = 0; i < urls.size(); i++) {
                    final String url = urls.get(i);
                    final int idx = i + 1;
                    final String stem = multi ? baseName + "_" + pad2(idx) : baseName;
                    status("[" + idx + "/" + urls.size() + "] 抓取中: " + url);
                    try {
                        Crawler.Page p = Crawler.fetch(url, 20000);
                        String content = Crawler.buildText(p, url, idx, urls.size());
                        Uri uri = save(stem + ".txt", content, tree);
                        long size = content.getBytes(StandardCharsets.UTF_8).length;
                        total += size;
                        made.add(uri);
                        ok++;
                        status("[" + idx + "/" + urls.size() + "] HTTP " + p.status + " | "
                                + shorten(p.title) + " | " + humanSize(size));
                    } catch (Exception e) {
                        failed++;
                        String msg = e.getClass().getSimpleName()
                                + (e.getMessage() == null ? "" : ": " + e.getMessage());
                        try {
                            String err = "源链接: " + url + "\n抓取时间: " + Crawler.now()
                                    + "\n结果: 抓取失败\n错误: " + msg + "\n";
                            made.add(save(stem + "_失败.txt", err, tree));
                        } catch (Exception ignored) {
                        }
                        status("[" + idx + "/" + urls.size() + "] 失败: " + url + " -> " + msg);
                    }
                }
                final List<Uri> fMade = made;
                final int fOk = ok, fFail = failed;
                final long fTotal = total;
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        done(fMade, fOk, fFail, fTotal);
                    }
                });
            }
        });
    }

    private void done(List<Uri> made, int ok, int failed, long total) {
        busy = false;
        startBtn.setEnabled(true);
        startBtn.setText("开始抓取");

        lastFiles.clear();
        lastFiles.addAll(made);

        if (made.isEmpty()) {
            sizeLabel.setText("无");
            sizeLabel.setTextColor(ERR);
        } else if (made.size() == 1) {
            sizeLabel.setText(humanSize(total));
            sizeLabel.setTextColor(ok == 0 ? ERR : OK);
        } else {
            sizeLabel.setText(made.size() + " 个文件 / 合计 " + humanSize(total));
            sizeLabel.setTextColor(ok == 0 ? ERR : OK);
        }

        if (ok == 0) {
            status("全部失败（" + failed + " 个）。可点「⑥」查看失败文件里的原因。");
        } else if (failed > 0) {
            status("完成：成功 " + ok + " 个 / 失败 " + failed + " 个");
        } else {
            status("完成 " + ok + " 个页面，已分别保存为 " + ok + " 个独立 txt");
        }
    }

    // -------------------------------------------------------------- 保存

    private Uri save(String fileName, String content, Uri tree) throws IOException {
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        ContentResolver cr = getContentResolver();

        // 1) 用户指定的目录（SAF）
        if (tree != null) {
            Uri dir = DocumentsContract.buildDocumentUriUsingTree(tree,
                    DocumentsContract.getTreeDocumentId(tree));
            Uri doc = DocumentsContract.createDocument(cr, dir, "text/plain", fileName);
            if (doc == null) throw new IOException("无法在所选目录创建文件");
            OutputStream os = cr.openOutputStream(doc, "w");
            if (os == null) throw new IOException("无法写入所选目录");
            try {
                os.write(bytes);
            } finally {
                os.close();
            }
            return doc;
        }

        // 2) 默认：公共「下载/WebCrawler」目录（Android 10+ 无需任何权限）
        ContentValues cv = new ContentValues();
        cv.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
        cv.put(MediaStore.MediaColumns.MIME_TYPE, "text/plain");
        cv.put(MediaStore.MediaColumns.RELATIVE_PATH,
                Environment.DIRECTORY_DOWNLOADS + "/WebCrawler");
        Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
        if (uri == null) throw new IOException("无法在下载目录创建文件");
        OutputStream os = cr.openOutputStream(uri, "w");
        if (os == null) throw new IOException("无法写入下载目录");
        try {
            os.write(bytes);
        } finally {
            os.close();
        }
        return uri;
    }

    // ---------------------------------------------------------- 查看文件

    private String displayName(Uri u) {
        String seg = u == null ? null : u.getLastPathSegment();
        if (seg == null) return String.valueOf(u);
        int i = seg.lastIndexOf('/');
        String name = i >= 0 ? seg.substring(i + 1) : seg;
        int c = name.indexOf(':');
        if (c >= 0) name = name.substring(c + 1);
        return name;
    }

    private void showFiles() {
        if (lastFiles.isEmpty()) {
            toast("还没有生成文件，先抓取一次吧");
            return;
        }
        final String[] items = new String[lastFiles.size()];
        for (int i = 0; i < lastFiles.size(); i++) {
            items[i] = displayName(lastFiles.get(i));
        }
        new AlertDialog.Builder(this)
                .setTitle("已生成 " + items.length + " 个文件（点击打开）")
                .setItems(items, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        openFile(lastFiles.get(which));
                    }
                })
                .setPositiveButton("关闭", null)
                .show();
    }

    private void openFile(Uri uri) {
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "text/plain");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(i);
        } catch (Exception e) {
            toast("没有可以打开 txt 的应用");
        }
    }
}
