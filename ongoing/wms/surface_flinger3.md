 LayerDim --> Layer --> SurfaceFlingerConsumer::ContentsChangedListener 
  onFrameAvailable
  sp<SurfaceFlingerConsumer> mSurfaceFlingerConsumer;
  sp<IGraphicBufferProducer> mProducer;
  
  
Client -->  BnSurfaceComposerClient
EventThread -->  Thread , VSyncSource::Callback [onVSyncEvent]
    
SurfaceFlingerConsumer --> GLConsumer --> ConsumerBase 
MonitoredProducer ->  IGraphicBufferProducer



frameworks/native/libs/gui/
    - BufferQueueConsumer.h
    - BufferQueueProducer.h
    - IGraphicBufferConsumer.h
    - IGraphicBufferProducer.h

frameworks/native/include/binder/IInterface.h
