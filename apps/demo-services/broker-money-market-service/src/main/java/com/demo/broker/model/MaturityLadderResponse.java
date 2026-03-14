package com.demo.broker.model;

import java.util.List;

public class MaturityLadderResponse {
    private String currency;
    private List<MaturityBucketRecord> buckets;

    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }
    public List<MaturityBucketRecord> getBuckets() { return buckets; }
    public void setBuckets(List<MaturityBucketRecord> buckets) { this.buckets = buckets; }
}
