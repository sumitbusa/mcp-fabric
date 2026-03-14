package com.demo.broker.model;

public class MaturityBucketRecord {
    private String maturityBucket;
    private Double outstanding;
    private Integer dealCount;

    public String getMaturityBucket() { return maturityBucket; }
    public void setMaturityBucket(String maturityBucket) { this.maturityBucket = maturityBucket; }
    public Double getOutstanding() { return outstanding; }
    public void setOutstanding(Double outstanding) { this.outstanding = outstanding; }
    public Integer getDealCount() { return dealCount; }
    public void setDealCount(Integer dealCount) { this.dealCount = dealCount; }
}
