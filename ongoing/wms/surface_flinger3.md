 LayerDim --> Layer --> SurfaceFlingerConsumer::ContentsChangedListener 
  onFrameAvailable
  sp<SurfaceFlingerConsumer> mSurfaceFlingerConsumer;
  sp<IGraphicBufferProducer> mProducer;
  
  
Client -->  BnSurfaceComposerClient
EventThread -->  Thread , VSyncSource::Callback [onVSyncEvent]
    
SurfaceFlingerConsumer --> GLConsumer --> ConsumerBase 
MonitoredProducer ->  IGraphicBufferProducer



IGraphicBufferConsumer 和 IGraphicBufferProducer
BufferQueueConsumer -->  BnGraphicBufferConsumer --> BnInterface<IGraphicBufferConsumer> --> IInterface
BufferQueueProducer --> BnGraphicBufferProducer,IBinder::DeathRecipient --> BnInterface<IGraphicBufferProducer>