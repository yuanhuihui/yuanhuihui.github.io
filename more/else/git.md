
## git log

    git log
    git log -p -2  //最近两次提交,每次提交的内容差异
    git log --stat //显示每次提交相关修改的总结



### pretty=format

    git log --pretty=oneline   //每个提交只显示一行

    git log --pretty=format:"%h - %an, %ae, %ar : %s" //显示作者,提交等定制信息

    git log --author=yuanhuihui  //显示指定作者相关的提交

    git log --grep=processgroup  //显示含指定关键字的提交

    git log -5  //最近5条提交

### 参考

    https://git-scm.com/book/zh/v2/Git-%E5%9F%BA%E7%A1%80-%E6%9F%A5%E7%9C%8B%E6%8F%90%E4%BA%A4%E5%8E%86%E5%8F%B2
