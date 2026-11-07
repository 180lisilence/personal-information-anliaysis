import com.angel.webcrawler.Crawler;

public class TestCrawler {
    public static void main(String[] args) throws Exception {
        String url = args[0];
        Crawler.Page p = Crawler.fetch(url, 15000);
        System.out.println("HTTP状态 : " + p.status);
        System.out.println("标题     : " + p.title);
        System.out.println("描述     : " + p.description);
        System.out.println("正文长度 : " + p.body.length());
        System.out.println("链接数   : " + p.links.size());
        System.out.println("---- 正文预览 ----");
        System.out.println(Crawler.buildText(p, url, 1, 1));
    }
}
