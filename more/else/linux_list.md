hlist_for_each_entry
hlist_add_head

## 一. 链表

普通的链表实现,都是将数据内嵌到链表中, 而Linux是将链表内嵌到数据对象.

链表代码在头文件<linux/list.h>, 全路径为kernel/include/linux/list.h.

### 1. 链表初始化

结构体list_head:

    struct list_head {  
        struct list_head *next, *prev;  
    };  

这是一个双向的环形链表.

    #define LIST_HEAD_INIT(name) { &(name), &(name) }

    #define LIST_HEAD(name) /
        struct list_head name = LIST_HEAD_INIT(name)

可见, LIST_HEAD()可完成链表初始化.

### 2. 访问数据

    #define list_entry(ptr, type, member) \  
        container_of(ptr, type, member)  



### 3. 添加

    //将new 插入到head后
    void list_add(struct list_head *new, struct list_head *head)

    //将new 插入到head前
    void list_add_tail(struct list_head *new, struct list_head *head)


    //从链表中删除 entry
    void list_del(struct list_head *entry)

    // 链表 是否为空
    int list_empty(const struct list_head *head)

    //获取整个结构体
    list_entry(ptr, type, member)

### 4. 循环遍历


    ist_for_each(pos, head)

    list_for_each_entry(pos, head, member)


https://www.zybuluo.com/ligq/note/114380


## 二. 其他

### 1. LIST_HEAD_INIT

	#define LIST_HEAD_INIT(name) { &(name), &(name) }
	#define LIST_HEAD(name) /
	    struct list_head name = LIST_HEAD_INIT(name)

等价于：

	#define LIST_HEAD(name)/
	struct list_head name = {&(name),&(name)}

最后等价于

	struct list_head head;
	head.prev=&head;
	head.next=&prev;

## 红黑树

### rb_insert_color
node是新插入的结点，有着默认的红色，本函数检查是否有违背红黑树性质的地方，并进行调整。

	void rb_insert_color(rb_node *node, rb_root *root)

### rb_link_node


把parent设为node的父结点，并且让rb_link指向node。

	static inline void rb_link_node(struct rb_node * node, struct rb_node * parent, struct rb_node ** rb_link);

## 其他

	struct rb_root
	struct rb_node

	struct hlist_node
	struct hlist_head
	struct list_head


1 struct hlist_head定义：

	struct hlist_head {
	   struct hlist_node *first;
	};
	struct hlist_node {
	   struct hlist_node *next, **pprev;
	};

2 struct list_head定义：

	struct list_head {
	 struct list_node *next，*prev;
	};
