package com.demo.dtcc.model;

import java.util.List;

public class DtccOutstandingResponse {
    private String currency;
    private Double totalAmount;
    private String largestIssuerId;
    private List<IssuerOutstandingRecord> topIssuers;

    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }
    public Double getTotalAmount() { return totalAmount; }
    public void setTotalAmount(Double totalAmount) { this.totalAmount = totalAmount; }
    public String getLargestIssuerId() { return largestIssuerId; }
    public void setLargestIssuerId(String largestIssuerId) { this.largestIssuerId = largestIssuerId; }
    public List<IssuerOutstandingRecord> getTopIssuers() { return topIssuers; }
    public void setTopIssuers(List<IssuerOutstandingRecord> topIssuers) { this.topIssuers = topIssuers; }
}
