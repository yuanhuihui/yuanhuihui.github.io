

1. __get_free_pages(), alloc_pages()，从分区页框分配器中获取页框
2. kmem_cache_alloc(), kmalloc(), 使用slab分配器l来分配块
3. vmalloc(), 获取非连续内存区
